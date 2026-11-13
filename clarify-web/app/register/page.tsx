'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  ShieldCheck,
} from 'lucide-react';
import { registerApi } from '@/src/lib/api-client';
import { getFieldValidationError } from '@/src/lib/domain-logic';
import { useClarify } from '@/src/context/ClarifyContext';
import type { LaravelValidationError, User } from '@/src/types/api';

const DEPARTMENTS = ['CITC', 'CEA', 'COT', 'CSM', 'CSTE'] as const;

export default function RegisterPage() {
  const { showToast } = useClarify();

  const [role, setRole] = useState<'student' | 'faculty'>('student');
  const [name, setName] = useState('');
  const [institutionalId, setInstitutionalId] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState<string>('CITC');
  const [section, setSection] = useState('IT3R2');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [registeredUser, setRegisteredUser] = useState<User | null>(null);

  const handleRoleSwitch = (nextRole: 'student' | 'faculty') => {
    setRole(nextRole);
    if (nextRole === 'faculty' && section === 'IT3R2') {
      setSection(`${department} Dept`);
    } else if (nextRole === 'student' && section.endsWith('Dept')) {
      setSection('IT3R2');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setGeneralError(null);

    if (password !== confirmPassword) {
      setFieldErrors({
        confirm_password: ['Passwords do not match.'],
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await registerApi({
        name,
        institutional_id: institutionalId,
        email,
        password,
        role,
        department,
        section,
      });
      setRegisteredUser(res.data);
      showToast(
        res.message ||
          'Account registered! Pending IT Administrator approval.',
        'success'
      );
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        setGeneralError(
          apiErr.message || 'Could not complete registration. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = getFieldValidationError(fieldErrors, 'name');
  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const emailError = getFieldValidationError(fieldErrors, 'email');
  const sectionError = getFieldValidationError(fieldErrors, 'section');
  const passwordError = getFieldValidationError(fieldErrors, 'password');
  const confirmPasswordError = getFieldValidationError(
    fieldErrors,
    'confirm_password'
  );

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left Side: Institutional Branding Card */}
      <div className="w-full lg:w-[55%] bg-ustp-navy text-white p-8 lg:p-16 flex flex-col items-center justify-center">
        <div className="bg-slate-100 text-ustp-text border-2 border-ustp-gold rounded-lg p-8 sm:p-10 max-w-xl w-full text-center shadow-lg">
          <div className="inline-flex items-center justify-center mb-3">
            <Image
              src="/assets/aistudio/image_07899ab9.png"
              alt="ClariFy"
              width={200}
              height={68}
              unoptimized
              className="h-12 sm:h-14 w-auto object-contain"
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-ustp-navy tracking-tight">
            Account Registration
          </h1>
          <p className="text-sm font-bold text-ustp-blue mt-1.5">
            Student &amp; Faculty Campus Portal Sign Up
          </p>
          <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">
            Create your Student or Faculty account to join scoped Course Hubs,
            receive official department announcements, and participate in Q&amp;A
            discussions.
          </p>

          <div className="mt-6 pt-5 border-t border-slate-300 text-left space-y-2.5 text-xs text-slate-700">
            <p className="font-extrabold text-ustp-navy uppercase tracking-wider">
              How Account Verification Works:
            </p>
            <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
              <li>
                Select whether you are registering as a{' '}
                <span className="font-bold text-ustp-navy">Student</span> or{' '}
                <span className="font-bold text-ustp-navy">Faculty</span> member
                and complete your academic details.
              </li>
              <li>
                Your new account is saved to the PostgreSQL database with{' '}
                <span className="font-bold text-amber-800">
                  Pending Verification
                </span>{' '}
                status.
              </li>
              <li>
                An{' '}
                <span className="font-bold text-ustp-navy">
                  IT Administrator
                </span>{' '}
                reviews and approves your pending registration in the Admin
                Console before you can sign in.
              </li>
            </ol>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-300 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              Already have an account?
            </span>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded hover:opacity-95"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Right Side: Registration Form Panel */}
      <div className="w-full lg:w-[45%] bg-ustp-orange text-ustp-text p-8 sm:p-10 flex flex-col items-center justify-center border-l border-amber-700/30">
        <div className="w-full max-w-md space-y-5">
          <div className="flex flex-col items-center text-center">
            <div className="px-5 py-2.5 rounded-2xl bg-ustp-navy border-4 border-ustp-gold flex flex-col items-center justify-center shadow-md">
              <Image
                src="/assets/aistudio/image_07899ab9.png"
                alt="ClariFy"
                width={130}
                height={40}
                unoptimized
                className="h-10 w-auto object-contain"
              />
            </div>
            <h2 className="mt-3 text-xl font-extrabold text-ustp-navy">
              Create Institutional Account
            </h2>
            <p className="text-xs font-semibold text-ustp-text/80">
              Student &amp; Faculty Self-Registration
            </p>
          </div>

          {registeredUser ? (
            <div className="bg-white border-2 border-ustp-navy rounded-lg p-6 space-y-4 shadow-md">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-extrabold text-ustp-navy">
                    Registration Submitted!
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Your{' '}
                    <span className="font-bold uppercase text-ustp-navy">
                      {registeredUser.role}
                    </span>{' '}
                    account for{' '}
                    <span className="font-bold text-ustp-text">
                      {registeredUser.name}
                    </span>{' '}
                    (ID:{' '}
                    <span className="font-mono font-bold">
                      {registeredUser.institutional_id}
                    </span>
                    ) has been saved to the PostgreSQL database.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-950 space-y-1">
                <p className="font-extrabold">
                  Status: Pending IT Administrator Approval
                </p>
                <p className="leading-relaxed">
                  Before you can sign in to your domain, an IT Administrator
                  must approve your registration in the Account Verification
                  Queue.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setRegisteredUser(null);
                    setName('');
                    setInstitutionalId('');
                    setEmail('');
                    setPassword('');
                    setConfirmPassword('');
                  }}
                  className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-ustp-navy bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 cursor-pointer"
                >
                  Register Another Account
                </button>
                <Link
                  href="/login"
                  className="w-full sm:w-auto text-center px-5 py-2 text-xs font-extrabold bg-ustp-navy text-ustp-gold rounded hover:opacity-95"
                >
                  Proceed to Login Page
                </Link>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="bg-white/95 border-2 border-ustp-navy rounded-lg p-6 space-y-4 shadow-md"
              noValidate
            >
              {generalError && (
                <div
                  role="alert"
                  className="p-3 bg-red-100 border border-red-400 rounded text-xs font-semibold text-red-900 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{generalError}</span>
                </div>
              )}

              {/* Role Selector: Student vs Faculty */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-ustp-navy mb-1.5">
                  Account Domain Role
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleRoleSwitch('student')}
                    className={`py-2.5 px-3 rounded border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      role === 'student'
                        ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <GraduationCap className="w-4 h-4" />
                    <span>Student</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRoleSwitch('faculty')}
                    className={`py-2.5 px-3 rounded border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      role === 'faculty'
                        ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Faculty</span>
                  </button>
                </div>
              </div>

              {/* Full Name */}
              <div>
                <label
                  htmlFor="reg-name"
                  className="block text-xs font-bold text-ustp-text mb-1"
                >
                  Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    role === 'faculty'
                      ? 'e.g., Prof. Aki Hayakawa'
                      : 'e.g., Kobeni Higashiyama'
                  }
                  className="w-full px-3 py-2 text-sm bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                />
                {nameError && (
                  <p
                    className="text-xs font-bold text-red-700 mt-1"
                    role="alert"
                  >
                    {nameError}
                  </p>
                )}
              </div>

              {/* Institutional ID & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-id"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Institutional ID
                  </label>
                  <input
                    id="reg-id"
                    type="text"
                    value={institutionalId}
                    onChange={(e) => setInstitutionalId(e.target.value)}
                    placeholder={
                      role === 'faculty' ? 'e.g., 10492' : 'e.g., 2020202020'
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {idError && (
                    <p
                      className="text-xs font-bold text-red-700 mt-1"
                      role="alert"
                    >
                      {idError}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="reg-email"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Institutional Email
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@ustp.edu.ph"
                    className="w-full px-3 py-2 text-sm bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {emailError && (
                    <p
                      className="text-xs font-bold text-red-700 mt-1"
                      role="alert"
                    >
                      {emailError}
                    </p>
                  )}
                </div>
              </div>

              {/* Department & Section */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-department"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    College / Department
                  </label>
                  <select
                    id="reg-department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="reg-section"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    {role === 'faculty'
                      ? 'Academic Unit / Section'
                      : 'Class Section'}
                  </label>
                  <input
                    id="reg-section"
                    type="text"
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    placeholder={
                      role === 'faculty' ? 'e.g., CITC Dept' : 'e.g., IT3R2'
                    }
                    className="w-full px-3 py-2 text-sm bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                  />
                  {sectionError && (
                    <p
                      className="text-xs font-bold text-red-700 mt-1"
                      role="alert"
                    >
                      {sectionError}
                    </p>
                  )}
                </div>
              </div>

              {/* Password & Confirm Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-password"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full pl-3 pr-11 py-2 text-sm bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      aria-pressed={showPassword}
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded text-slate-500 hover:text-ustp-navy focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer"
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
                      className="text-xs font-bold text-red-700 mt-1"
                      role="alert"
                    >
                      {passwordError}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="reg-confirm-password"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="reg-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full pl-3 pr-11 py-2 text-sm bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={
                        showConfirmPassword ? 'Hide password' : 'Show password'
                      }
                      aria-pressed={showConfirmPassword}
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded text-slate-500 hover:text-ustp-navy focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer"
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
                      className="text-xs font-bold text-red-700 mt-1"
                      role="alert"
                    >
                      {confirmPasswordError}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <Link
                  href="/login"
                  className="text-xs font-bold text-ustp-navy hover:underline"
                >
                  &larr; Back to Sign In
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 bg-ustp-navy text-ustp-gold text-xs font-extrabold rounded border border-ustp-navy hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Creating Account...' : 'Create Account'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
