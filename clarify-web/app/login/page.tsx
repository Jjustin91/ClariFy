'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Eye,
  EyeOff,
  ShieldAlert,
  UserPlus,
} from 'lucide-react';
import { loginApi } from '@/src/lib/api-client';
import { getFieldValidationError } from '@/src/lib/domain-logic';
import { useClarify } from '@/src/context/ClarifyContext';
import type { LaravelValidationError, VerificationStatus } from '@/src/types/api';

export default function LoginPage() {
  const router = useRouter();
  const { setUser, showToast } = useClarify();

  const [institutionalId, setInstitutionalId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const authenticateWithCredentials = async (idToUse: string, passToUse: string) => {
    setIsLoading(true);
    setFieldErrors({});
    setPendingNotice(null);
    setGeneralError(null);

    try {
      const res = await loginApi(idToUse, passToUse);
      setUser(res.user);
      const domainLabel =
        res.user.role === 'faculty' || res.user.role === 'dept_head'
          ? 'Faculty Domain'
          : res.user.role === 'it_admin'
          ? 'IT Admin Domain'
          : 'Student Domain';
      showToast(`Signed in to ${domainLabel} as ${res.user.name}.`, 'success');
      if (res.user.role === 'it_admin') {
        router.push('/admin');
      } else {
        router.push('/');
      }
    } catch (err) {
      const apiErr = err as LaravelValidationError & {
        verification_status?: VerificationStatus;
      };
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (
        apiErr.status === 403 &&
        (apiErr.verification_status === 'pending' ||
          apiErr.verification_status === 'rejected' ||
          apiErr.message.includes('pending') ||
          apiErr.message.includes('rejected'))
      ) {
        setPendingNotice(
          apiErr.message ||
            'Your account is pending IT Administrator registrar verification.'
        );
      } else {
        setGeneralError(apiErr.message || 'Authentication failed.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await authenticateWithCredentials(institutionalId, password);
  };

  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const passwordError = getFieldValidationError(fieldErrors, 'password');

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left Side (70% width on desktop): Deep ustp-navy (#1a1851) background with ClariFy Mobile App QR card */}
      <div className="w-full lg:w-[70%] bg-ustp-navy text-white p-4 sm:p-8 lg:p-16 flex flex-col items-center justify-center">
        <div className="bg-slate-100 text-ustp-text border-2 border-ustp-gold rounded-lg p-6 sm:p-10 max-w-md w-full text-center shadow-lg">
          <h1 className="text-xl sm:text-2xl font-extrabold text-ustp-navy tracking-tight">
            ClariFy Mobile App
          </h1>
          <p className="text-xs sm:text-sm font-semibold text-ustp-blue mt-1">
            Stay connected to campus notices on the go
          </p>

          <div className="mt-5 mb-5 flex justify-center">
            <div className="bg-white p-3.5 rounded-lg border border-slate-300 inline-flex items-center justify-center">
              <Image
                src="/assets/aistudio/image_82c2a523.png"
                alt="ClariFy Mobile App QR Code"
                width={224}
                height={224}
                priority
                unoptimized
                className="w-48 h-48 sm:w-56 sm:h-56 object-contain"
              />
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-xs mx-auto">
            Scan this QR code with your phone camera to download and open the ClariFy Mobile app.
          </p>
        </div>
      </div>

      {/* Right Side (30% width on desktop): Full-height ustp-orange (#ff9718) institutional branding & login panel */}
      <div className="w-full lg:w-[30%] bg-ustp-orange text-ustp-text p-5 sm:p-8 flex flex-col items-center justify-center border-l border-amber-700/30">
        <div className="w-full max-w-xs space-y-5">
          {/* Moved Institutional Branding Header */}
          <div className="flex flex-col items-center text-center">
            <div className="mb-3 px-5 py-2.5 rounded-xl bg-ustp-navy border-2 border-ustp-gold inline-flex items-center justify-center shadow-sm">
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
            <p className="text-xs sm:text-sm font-extrabold text-ustp-navy leading-snug">
              Unified Campus Noticeboard &amp; Scoped Communication Platform
            </p>
            <p className="text-[11px] font-semibold text-ustp-text/80 mt-1 leading-relaxed">
              University of Science and Technology of Southern Philippines — Cagayan de Oro Campus
            </p>
          </div>

          <div className="border-t border-ustp-navy/15 pt-4">
            <h2 className="text-base font-extrabold text-ustp-navy text-center">
              Institutional Sign In
            </h2>
            <p className="text-xs font-semibold text-ustp-text/80 text-center mt-0.5">
              Enter your Institutional ID &amp; Password
            </p>
          </div>

          {/* 403 Forbidden Pending Verification Banner */}
          {pendingNotice && (
            <div
              role="alert"
              className="p-3.5 bg-red-100 border-2 border-red-700 rounded-md text-xs text-red-950 space-y-1"
            >
              <div className="font-extrabold flex items-center gap-1.5 text-red-900">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Verification Pending</span>
              </div>
              <p className="font-semibold leading-relaxed">{pendingNotice}</p>
            </div>
          )}

          {generalError && (
            <div
              role="alert"
              className="p-3 bg-red-100 border border-red-400 rounded text-xs font-semibold text-red-900 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{generalError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
            <div>
              <label htmlFor="login-institutional-id" className="sr-only">
                Institutional ID Number
              </label>
              <input
                id="login-institutional-id"
                type="text"
                value={institutionalId}
                onChange={(e) => setInstitutionalId(e.target.value)}
                placeholder="Institutional ID Number"
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-white text-ustp-text placeholder:text-slate-400 border-2 border-white focus:border-ustp-navy rounded focus:outline-none"
              />
              {idError && (
                <p
                  className="text-xs font-extrabold text-red-900 bg-red-100/90 px-2 py-1 rounded mt-1"
                  role="alert"
                >
                  {idError}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="login-password" className="sr-only">
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full pl-3.5 pr-11 py-2.5 text-sm bg-white text-ustp-text placeholder:text-slate-400 border-2 border-white focus:border-ustp-navy rounded focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded text-slate-600 hover:text-ustp-navy focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer"
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
                  className="text-xs font-extrabold text-red-900 bg-red-100/90 px-2 py-1 rounded mt-1"
                  role="alert"
                >
                  {passwordError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end">
              <Link
                href="/forgot-password"
                className="text-xs font-bold text-ustp-navy hover:underline focus-visible:outline-2 focus-visible:outline-ustp-navy rounded px-1 py-0.5"
              >
                Forgot password?
              </Link>
            </div>

            <div className="pt-1 flex justify-center">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full px-8 py-2.5 bg-ustp-navy text-white text-sm font-extrabold rounded border border-ustp-navy hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
              >
                {isLoading ? 'Verifying...' : 'Enter'}
              </button>
            </div>
          </form>

          {/* Single Student/Faculty Registration CTA moved from left card */}
          <div className="pt-4 border-t border-ustp-navy/20">
            <div className="flex flex-col gap-2.5 text-center">
              <div>
                <p className="text-xs font-extrabold text-ustp-navy">
                  Student or Faculty Member?
                </p>
                <p className="text-[11px] font-medium text-ustp-text/85 mt-0.5 leading-snug">
                  Register your Student or Faculty account and get verified by the IT Admin.
                </p>
              </div>
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95 whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Sign Up</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
