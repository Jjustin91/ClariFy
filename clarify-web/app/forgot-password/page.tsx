'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  requestPasswordOtpApi,
  resetPasswordApi,
  verifyPasswordOtpApi,
} from '@/src/lib/api-client';
import {
  type PasswordResetStep,
  extractRetryAfterSeconds,
  formatOtpCooldownLabel,
  getFieldValidationError,
  sanitizeOtpInput,
  validatePasswordResetFields,
} from '@/src/lib/domain-logic';
import { useClarify } from '@/src/context/ClarifyContext';
import type { LaravelValidationError } from '@/src/types/api';

const STEP_ITEMS: Array<{
  key: Exclude<PasswordResetStep, 'done'>;
  number: string;
  title: string;
  detail: string;
}> = [
  {
    key: 'request',
    number: '1',
    title: 'Enter Institutional ID',
    detail: 'Request a 6-digit SMS verification code to your registered mobile number.',
  },
  {
    key: 'verify',
    number: '2',
    title: 'Verify 6-Digit SMS Code',
    detail: 'Confirm the one-time code within 5 minutes (maximum 5 attempts).',
  },
  {
    key: 'reset',
    number: '3',
    title: 'Set New Password',
    detail: 'Update your password and sign out all previously active sessions.',
  },
];

function getStepOrder(step: PasswordResetStep): number {
  if (step === 'request') return 1;
  if (step === 'verify') return 2;
  if (step === 'reset') return 3;
  return 4;
}

export default function ForgotPasswordPage() {
  const { showToast } = useClarify();

  const [step, setStep] = useState<PasswordResetStep>('request');
  const [institutionalId, setInstitutionalId] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [tokenExpiredError, setTokenExpiredError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRateLimitSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [rateLimitSeconds]);

  const clearErrors = () => {
    setFieldErrors({});
    setGeneralError(null);
    setTokenExpiredError(false);
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();

    const clientErrors = validatePasswordResetFields('request', {
      institutionalId,
    });
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    const trimmedId = institutionalId.trim();
    setInstitutionalId(trimmedId);
    setIsSubmitting(true);

    try {
      const res = await requestPasswordOtpApi(trimmedId);
      setInfoMessage(
        res.message ||
          'If the account exists, a code was sent to its registered mobile number.'
      );
      setCooldownSeconds(res.resend_cooldown_seconds ?? 60);
      setRateLimitSeconds(0);
      setOtp('');
      setStep('verify');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (apiErr.status === 429) {
        const waitSec = extractRetryAfterSeconds(apiErr, 60);
        setRateLimitSeconds(waitSec);
        setCooldownSeconds(waitSec);
        setGeneralError(
          apiErr.message ||
            `Too many attempts. Please try again in ${waitSec} seconds.`
        );
      } else {
        setGeneralError(
          apiErr.message ||
            'Unable to process your request right now. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldownSeconds > 0 || isResending) return;
    clearErrors();

    const trimmedId = institutionalId.trim();
    if (!trimmedId) {
      setStep('request');
      return;
    }

    setIsResending(true);
    try {
      const res = await requestPasswordOtpApi(trimmedId);
      setInfoMessage(
        res.message ||
          'If the account exists, a code was sent to its registered mobile number.'
      );
      setCooldownSeconds(res.resend_cooldown_seconds ?? 60);
      setRateLimitSeconds(0);
      setOtp('');
      showToast('A new verification code request was submitted.', 'info');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 429) {
        const waitSec = extractRetryAfterSeconds(apiErr, 60);
        setCooldownSeconds(waitSec);
        setRateLimitSeconds(waitSec);
        setGeneralError(
          apiErr.message ||
            `Please wait ${waitSec} seconds before requesting another code.`
        );
      } else {
        setGeneralError(
          apiErr.message || 'Unable to resend code right now. Please try again.'
        );
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();

    const cleanedOtp = sanitizeOtpInput(otp);
    setOtp(cleanedOtp);

    const clientErrors = validatePasswordResetFields('verify', {
      institutionalId,
      otp: cleanedOtp,
    });
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await verifyPasswordOtpApi({
        institutional_id: institutionalId.trim(),
        otp: cleanedOtp,
      });
      setResetToken(res.reset_token);
      setOtp('');
      setRateLimitSeconds(0);
      setInfoMessage(
        res.message ||
          'Verification code confirmed. Choose a strong new password below.'
      );
      setStep('reset');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422) {
        if (apiErr.errors) {
          setFieldErrors(apiErr.errors);
        } else {
          setFieldErrors({
            otp: [apiErr.message || 'Invalid or expired verification code.'],
          });
        }
      } else if (apiErr.status === 429) {
        const waitSec = extractRetryAfterSeconds(apiErr, 60);
        setRateLimitSeconds(waitSec);
        setGeneralError(
          apiErr.message ||
            `Too many verification attempts. Please try again in ${waitSec} seconds.`
        );
      } else {
        setGeneralError(
          apiErr.message || 'Verification failed. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();

    const clientErrors = validatePasswordResetFields('reset', {
      password,
      passwordConfirmation,
    });
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    if (!resetToken) {
      setTokenExpiredError(true);
      setGeneralError(
        'Your password reset session has expired. Please request a new SMS code.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await resetPasswordApi({
        institutional_id: institutionalId.trim(),
        reset_token: resetToken,
        password,
        password_confirmation: passwordConfirmation,
      });
      setResetToken('');
      setPassword('');
      setPasswordConfirmation('');
      setInfoMessage(
        res.message ||
          'Your password has been reset successfully. Please sign in with your new password.'
      );
      showToast('Password updated. Please sign in with your new password.', 'success');
      setStep('done');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422) {
        if (apiErr.errors?.reset_token) {
          setTokenExpiredError(true);
          setGeneralError(apiErr.errors.reset_token[0]);
        } else if (apiErr.errors) {
          setFieldErrors(apiErr.errors);
        } else {
          setGeneralError(
            apiErr.message || 'Could not reset password. Please check your input.'
          );
        }
      } else if (apiErr.status === 429) {
        const waitSec = extractRetryAfterSeconds(apiErr, 60);
        setRateLimitSeconds(waitSec);
        setGeneralError(
          apiErr.message ||
            `Too many attempts. Please try again in ${waitSec} seconds.`
        );
      } else {
        setGeneralError(
          apiErr.message || 'Unable to reset password right now. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const restartFlow = () => {
    clearErrors();
    setStep('request');
    setOtp('');
    setResetToken('');
    setPassword('');
    setPasswordConfirmation('');
    setInfoMessage(null);
  };

  const currentOrder = getStepOrder(step);
  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const otpError = getFieldValidationError(fieldErrors, 'otp');
  const passwordError = getFieldValidationError(fieldErrors, 'password');
  const confirmPasswordError = getFieldValidationError(
    fieldErrors,
    'password_confirmation'
  );

  return (
    <div className="min-h-screen flex flex-col-reverse lg:flex-row">
      {/* Left Side: USTP Navy Informational & Step Progress Panel */}
      <div className="w-full lg:w-[55%] bg-ustp-navy text-white p-6 sm:p-10 lg:p-16 flex flex-col items-center justify-center">
        <div className="bg-slate-100 text-ustp-text border-2 border-ustp-gold rounded-lg p-6 sm:p-10 max-w-xl w-full">
          <div className="flex flex-col items-center text-center">
            <div className="mb-3 px-4 py-2 rounded-lg bg-ustp-navy border border-ustp-gold inline-flex items-center justify-center">
              <Image
                src="/assets/clarify-logo.svg"
                alt="ClariFy"
                width={180}
                height={56}
                priority
                unoptimized
                className="h-10 sm:h-11 w-auto object-contain"
              />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ustp-navy tracking-tight">
              Password Recovery
            </h1>
            <p className="text-xs sm:text-sm font-bold text-ustp-blue mt-1">
              SMS One-Time Passcode (OTP) Verification
            </p>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed max-w-md">
              Reset your ClariFy institutional password using the Philippine mobile number
              registered on your verified USTP account.
            </p>
          </div>

          <ol
            aria-label="Password recovery progress"
            className="mt-6 pt-5 border-t border-slate-300 space-y-3 text-left"
          >
            {STEP_ITEMS.map((item, idx) => {
              const stepNum = idx + 1;
              const isCompleted = currentOrder > stepNum;
              const isCurrent = currentOrder === stepNum;

              return (
                <li
                  key={item.key}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex items-start gap-3 p-3 rounded-md border ${
                    isCurrent
                      ? 'bg-white border-ustp-navy'
                      : isCompleted
                      ? 'bg-emerald-50 border-emerald-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-extrabold font-mono tabular-nums ${
                      isCompleted
                        ? 'bg-emerald-700 text-white'
                        : isCurrent
                        ? 'bg-ustp-navy text-ustp-gold'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isCompleted ? '✓' : item.number}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`text-xs font-extrabold ${
                        isCurrent
                          ? 'text-ustp-navy'
                          : isCompleted
                          ? 'text-emerald-900'
                          : 'text-slate-700'
                      }`}
                    >
                      {item.title}
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                      {item.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 pt-4 border-t border-slate-300 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-600">
              Remembered your password?
            </span>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-navy"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Right Side: USTP Orange Action Panel */}
      <div className="w-full lg:w-[45%] bg-ustp-orange text-ustp-text p-6 sm:p-10 flex flex-col items-center justify-center border-l border-amber-700/30">
        <div className="w-full max-w-md space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-extrabold text-ustp-navy">
              {step === 'request' && 'Request SMS Verification Code'}
              {step === 'verify' && 'Verify Your SMS Code'}
              {step === 'reset' && 'Choose a New Password'}
              {step === 'done' && 'Password Reset Complete'}
            </h2>
            <p className="text-xs font-semibold text-ustp-text/85 mt-1">
              {step === 'request' &&
                'Only IT-Admin approved accounts with a registered mobile number can reset via SMS.'}
              {step === 'verify' &&
                'Enter the 6-digit code sent to the mobile number on file.'}
              {step === 'reset' &&
                'Your new password must be at least 8 characters long.'}
              {step === 'done' &&
                'All previous login sessions have been signed out for your security.'}
            </p>
          </div>

          <div className="bg-white border-2 border-ustp-navy rounded-lg p-6 space-y-4">
            {/* Non-enumerating info banner */}
            {infoMessage && step !== 'done' && (
              <div
                role="status"
                className="p-3 bg-sky-50 border border-sky-300 rounded text-xs font-semibold text-ustp-navy flex items-start gap-2"
              >
                <MessageSquareText className="w-4 h-4 text-ustp-blue shrink-0 mt-0.5" />
                <span className="leading-relaxed">{infoMessage}</span>
              </div>
            )}

            {/* General / 429 / Expired Reset Session Error Banner */}
            {generalError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-400 rounded text-xs font-semibold text-red-900 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    {generalError}
                    {rateLimitSeconds > 0 && (
                      <span className="block mt-1 font-mono tabular-nums font-extrabold text-red-950">
                        Available again in {rateLimitSeconds}s
                      </span>
                    )}
                  </span>
                </div>
                {tokenExpiredError && (
                  <button
                    type="button"
                    onClick={restartFlow}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Request New Code</span>
                  </button>
                )}
              </div>
            )}

            {/* STEP 1: REQUEST OTP */}
            {step === 'request' && (
              <form onSubmit={handleRequestOtp} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="forgot-institutional-id"
                    className="block text-xs font-extrabold uppercase tracking-wider text-ustp-navy mb-1.5"
                  >
                    Institutional ID Number
                  </label>
                  <input
                    id="forgot-institutional-id"
                    type="text"
                    autoComplete="username"
                    value={institutionalId}
                    onChange={(e) => setInstitutionalId(e.target.value)}
                    placeholder="e.g. 2026123456"
                    className="w-full px-3.5 py-2.5 min-h-[44px] text-sm font-mono tabular-nums bg-ustp-cream text-ustp-text placeholder:text-slate-400 border border-slate-300 focus:border-ustp-navy rounded focus:outline-none"
                  />
                  {idError && (
                    <p
                      role="alert"
                      className="text-xs font-bold text-red-700 mt-1"
                    >
                      {idError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || rateLimitSeconds > 0}
                  className="w-full px-5 py-2.5 min-h-[44px] bg-ustp-navy text-ustp-gold text-sm font-extrabold rounded hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer flex items-center justify-center gap-2"
                >
                  <MessageSquareText className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? 'Sending Verification Code...'
                      : rateLimitSeconds > 0
                      ? `Wait ${rateLimitSeconds}s`
                      : 'Send Verification Code'}
                  </span>
                </button>
              </form>
            )}

            {/* STEP 2: VERIFY 6-DIGIT OTP */}
            {step === 'verify' && (
              <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-ustp-cream border border-slate-200 rounded text-xs">
                  <div>
                    <span className="text-slate-500 font-semibold">
                      Institutional ID:{' '}
                    </span>
                    <span className="font-mono tabular-nums font-extrabold text-ustp-navy">
                      {institutionalId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={restartFlow}
                    className="text-xs font-extrabold text-ustp-blue hover:underline min-h-[36px] px-2 cursor-pointer"
                  >
                    Change ID
                  </button>
                </div>

                <div>
                  <label
                    htmlFor="forgot-otp-code"
                    className="block text-xs font-extrabold uppercase tracking-wider text-ustp-navy mb-1.5"
                  >
                    6-Digit SMS Verification Code
                  </label>
                  <input
                    id="forgot-otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(sanitizeOtpInput(e.target.value))}
                    placeholder="000000"
                    className="w-full px-4 py-3 min-h-[48px] text-xl font-mono tabular-nums font-extrabold tracking-[0.4em] text-center bg-ustp-cream text-ustp-navy placeholder:text-slate-300 border border-slate-300 focus:border-ustp-navy rounded focus:outline-none"
                  />
                  {otpError && (
                    <p
                      role="alert"
                      className="text-xs font-bold text-red-700 mt-1"
                    >
                      {otpError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || rateLimitSeconds > 0}
                  className="w-full px-5 py-2.5 min-h-[44px] bg-ustp-navy text-ustp-gold text-sm font-extrabold rounded hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isSubmitting ? 'Verifying Code...' : 'Verify Code'}</span>
                </button>

                <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-600">
                    Didn&apos;t receive an SMS?
                  </span>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={cooldownSeconds > 0 || isResending}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-extrabold text-ustp-navy bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded border border-slate-300 font-mono tabular-nums cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`}
                    />
                    <span>
                      {isResending
                        ? 'Sending...'
                        : formatOtpCooldownLabel(cooldownSeconds)}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: SET NEW PASSWORD */}
            {step === 'reset' && (
              <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="forgot-new-password"
                    className="block text-xs font-extrabold uppercase tracking-wider text-ustp-navy mb-1.5"
                  >
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="forgot-new-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full pl-3.5 pr-12 py-2.5 min-h-[44px] text-sm bg-ustp-cream text-ustp-text placeholder:text-slate-400 border border-slate-300 focus:border-ustp-navy rounded focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide new password' : 'Show new password'}
                      aria-pressed={showPassword}
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded text-slate-600 hover:text-ustp-navy cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {passwordError && (
                    <p
                      role="alert"
                      className="text-xs font-bold text-red-700 mt-1"
                    >
                      {passwordError}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="forgot-confirm-password"
                    className="block text-xs font-extrabold uppercase tracking-wider text-ustp-navy mb-1.5"
                  >
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      id="forgot-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={passwordConfirmation}
                      onChange={(e) => setPasswordConfirmation(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full pl-3.5 pr-12 py-2.5 min-h-[44px] text-sm bg-ustp-cream text-ustp-text placeholder:text-slate-400 border border-slate-300 focus:border-ustp-navy rounded focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={
                        showConfirmPassword
                          ? 'Hide password confirmation'
                          : 'Show password confirmation'
                      }
                      aria-pressed={showConfirmPassword}
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded text-slate-600 hover:text-ustp-navy cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {confirmPasswordError && (
                    <p
                      role="alert"
                      className="text-xs font-bold text-red-700 mt-1"
                    >
                      {confirmPasswordError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full px-5 py-2.5 min-h-[44px] bg-ustp-navy text-ustp-gold text-sm font-extrabold rounded hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>
                    {isSubmitting ? 'Updating Password...' : 'Reset Password'}
                  </span>
                </button>
              </form>
            )}

            {/* STEP 4: SUCCESS STATE */}
            {step === 'done' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3.5 bg-emerald-50 border border-emerald-300 rounded">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-extrabold text-emerald-950">
                      Your password has been updated
                    </p>
                    <p className="text-xs text-emerald-900 leading-relaxed">
                      {infoMessage ||
                        'Your password has been reset successfully. Please sign in with your new password.'}
                    </p>
                  </div>
                </div>

                <Link
                  href="/login"
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] bg-ustp-navy text-ustp-gold text-sm font-extrabold rounded hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-navy"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Proceed to Sign In</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
