'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
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
      {/* Left Side (70% width on desktop): Deep ustp-navy (#1a1851) background with centered institutional branding card */}
      <div className="w-full lg:w-[70%] bg-ustp-navy text-white p-8 lg:p-16 flex flex-col items-center justify-center">
        <div className="bg-slate-100 text-ustp-text border-2 border-ustp-gold rounded-lg p-8 sm:p-12 max-w-xl w-full text-center shadow-lg">
          <div className="inline-flex items-center justify-center mb-3">
            <Image
              src="/assets/aistudio/image_07899ab9.png"
              alt="ClariFy"
              width={220}
              height={76}
              unoptimized
              className="h-14 sm:h-16 w-auto object-contain"
            />
          </div>
          <p className="text-sm sm:text-base font-bold text-ustp-blue mt-1">
            Unified Campus Noticeboard &amp; Scoped Communication Platform
          </p>
          <p className="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
            University of Science and Technology of Southern Philippines — Cagayan de Oro Campus (IT314 Software Engineering • IT3R2 Group 5)
          </p>

          {/* Student/Faculty Registration Link */}
          <div className="mt-8 pt-6 border-t border-slate-300 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-ustp-navy">
                  Student or Faculty Member?
                </p>
                <p className="text-[11px] text-slate-600">
                  Register your Student or Faculty account and get verified by the IT Admin.
                </p>
              </div>
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95 whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Sign Up</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side (30% width on desktop): Full-height ustp-orange (#ff9718) vertical login panel */}
      <div className="w-full lg:w-[30%] bg-ustp-orange text-ustp-text p-8 sm:p-10 flex flex-col items-center justify-center border-l border-amber-700/30">
        <div className="w-full max-w-xs space-y-6">
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-ustp-navy border-4 border-ustp-gold flex flex-col items-center justify-center shadow-md">
              <span className="text-2xl font-extrabold text-ustp-gold tracking-tight">
                C
              </span>
              <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                USTP
              </span>
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-ustp-navy">
              Institutional Sign In
            </h2>
            <p className="text-xs font-semibold text-ustp-text/80">
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
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-3.5 py-2.5 text-sm bg-white text-ustp-text placeholder:text-slate-400 border-2 border-white focus:border-ustp-navy rounded focus:outline-none"
              />
              {passwordError && (
                <p
                  className="text-xs font-extrabold text-red-900 bg-red-100/90 px-2 py-1 rounded mt-1"
                  role="alert"
                >
                  {passwordError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Link
                href="/register"
                className="text-xs font-extrabold text-ustp-navy hover:underline"
              >
                Create Account (Sign Up)
              </Link>
              <button
                type="button"
                onClick={() =>
                  showToast(
                    'Password recovery link dispatched via USTP ICTO Registrar portal.',
                    'info'
                  )
                }
                className="text-xs font-bold text-ustp-navy hover:underline cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>

            <div className="pt-2 flex justify-center">
              <button
                type="submit"
                disabled={isLoading}
                className="px-8 py-2.5 bg-ustp-navy text-white text-sm font-extrabold rounded border border-ustp-navy hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
              >
                {isLoading ? 'Verifying...' : 'Enter'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
