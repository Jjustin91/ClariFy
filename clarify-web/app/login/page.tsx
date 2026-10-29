'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ShieldAlert, ShieldCheck, UserCheck } from 'lucide-react';
import { loginApi } from '@/src/lib/api-client';
import { getFieldValidationError } from '@/src/lib/domain-logic';
import { useClarify } from '@/src/context/ClarifyContext';
import type { LaravelValidationError, VerificationStatus } from '@/src/types/api';

export default function LoginPage() {
  const router = useRouter();
  const { setUser, showToast } = useClarify();

  const [institutionalId, setInstitutionalId] = useState('2020202020');
  const [password, setPassword] = useState('ustp2026');
  const [isLoading, setIsLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setFieldErrors({});
    setPendingNotice(null);
    setGeneralError(null);

    try {
      const res = await loginApi(institutionalId, password);
      setUser(res.user);
      showToast(`Welcome back, ${res.user.name}!`, 'success');
      router.push('/');
    } catch (err) {
      const apiErr = err as LaravelValidationError & {
        verification_status?: VerificationStatus;
      };
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (
        apiErr.status === 403 &&
        (apiErr.verification_status === 'pending' ||
          apiErr.message.includes('pending'))
      ) {
        setPendingNotice(
          'Your account is pending IT Administrator registrar verification (FR-08).'
        );
      } else {
        setGeneralError(apiErr.message || 'Authentication failed.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fillDemoAccount = (id: string, pass: string) => {
    setInstitutionalId(id);
    setPassword(pass);
    setFieldErrors({});
    setPendingNotice(null);
    setGeneralError(null);
  };

  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const passwordError = getFieldValidationError(fieldErrors, 'password');

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left Side (70% width on desktop): Deep ustp-navy (#1a1851) background with centered institutional branding card */}
      <div className="w-full lg:w-[70%] bg-ustp-navy text-white p-8 lg:p-16 flex flex-col items-center justify-center">
        <div className="bg-slate-100 text-ustp-text border-2 border-ustp-gold rounded-lg p-8 sm:p-12 max-w-xl w-full text-center shadow-lg">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-lg bg-ustp-navy text-ustp-gold font-extrabold text-2xl border-2 border-ustp-gold mb-5">
            USTP
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-ustp-navy tracking-tight">
            ClariFy
          </h1>
          <p className="text-sm sm:text-base font-bold text-ustp-blue mt-2">
            Unified Campus Noticeboard &amp; Scoped Communication Platform
          </p>
          <p className="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
            University of Science and Technology of Southern Philippines — Cagayan de Oro Campus (IT314 Software Engineering • IT3R2 Group 5)
          </p>

          {/* Quick Evaluator Credential Presets */}
          <div className="mt-8 pt-6 border-t border-slate-300 text-left">
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-600 mb-2.5 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-ustp-navy" />
              One-Click Role Presets (Workflow 1 &amp; FR-08 Verification Test)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fillDemoAccount('2020202020', 'ustp2026')}
                className="px-3 py-2 text-left text-xs bg-white hover:bg-amber-50 border border-slate-300 rounded flex items-center justify-between cursor-pointer"
              >
                <span className="font-bold text-ustp-navy">Kobeni (Student)</span>
                <span className="font-mono text-slate-600 tabular-nums">2020202020</span>
              </button>
              <button
                type="button"
                onClick={() => fillDemoAccount('10492', 'ustp2026')}
                className="px-3 py-2 text-left text-xs bg-white hover:bg-amber-50 border border-slate-300 rounded flex items-center justify-between cursor-pointer"
              >
                <span className="font-bold text-ustp-navy">Aki (Faculty)</span>
                <span className="font-mono text-slate-600 tabular-nums">10492</span>
              </button>
              <button
                type="button"
                onClick={() => fillDemoAccount('90001', 'ustp2026')}
                className="px-3 py-2 text-left text-xs bg-white hover:bg-amber-50 border border-slate-300 rounded flex items-center justify-between cursor-pointer"
              >
                <span className="font-bold text-ustp-navy">Makima (IT Admin)</span>
                <span className="font-mono text-slate-600 tabular-nums">90001</span>
              </button>
              <button
                type="button"
                onClick={() => fillDemoAccount('2023309999', 'ustp2026')}
                className="px-3 py-2 text-left text-xs bg-red-50 hover:bg-red-100 border border-red-300 rounded flex items-center justify-between cursor-pointer"
              >
                <span className="font-bold text-red-800">Pending (FR-08 403)</span>
                <span className="font-mono text-red-700 tabular-nums">2023309999</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side (30% width on desktop): Full-height ustp-orange (#ff9718) vertical login panel matching Wireframe Page 1 */}
      <div className="w-full lg:w-[30%] bg-ustp-orange text-ustp-text p-8 sm:p-10 flex flex-col items-center justify-center border-l border-amber-700/30">
        <div className="w-full max-w-xs space-y-6">
          {/* Circular User/Mascot Emblem at the top matching Page 1 */}
          <div className="flex flex-col items-center">
            <div className="w-28 h-28 rounded-full bg-ustp-gold border-4 border-ustp-navy flex flex-col items-center justify-center shadow-md">
              <ShieldCheck className="w-12 h-12 text-ustp-navy stroke-[2.2]" />
              <span className="text-[11px] font-extrabold text-ustp-navy tracking-tight mt-0.5">
                PRISMS SSO
              </span>
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-ustp-navy">
              Institutional Sign In
            </h2>
            <p className="text-xs font-semibold text-ustp-text/80">
              POST /api/v1/auth/login
            </p>
          </div>

          {/* 403 Forbidden Pending Verification Banner (FR-08) */}
          {pendingNotice && (
            <div
              role="alert"
              className="p-3.5 bg-red-100 border-2 border-red-700 rounded-md text-xs text-red-950 space-y-1"
            >
              <div className="font-extrabold flex items-center gap-1.5 text-red-900">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>HTTP 403 Forbidden — Verification Pending</span>
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
                placeholder="ID Number e.g., 2020202020"
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

            <div className="flex justify-end">
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
