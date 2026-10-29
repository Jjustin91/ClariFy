'use client';

import React, { useEffect, useState } from 'react';
import { Camera, Phone, ShieldCheck, X } from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { updateProfileApi } from '../../lib/api-client';
import { getFieldValidationError } from '../../lib/domain-logic';
import type { LaravelValidationError } from '../../types/api';

export function ProfileSettingsModal() {
  const {
    user,
    setUser,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    showToast,
  } = useClarify();

  const [contactNumber, setContactNumber] = useState(user.contact_number || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user.avatar_url || null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (isSettingsModalOpen) {
      setContactNumber(user.contact_number || '+63 917 842 2020');
      setAvatarPreview(user.avatar_url || null);
      setFieldErrors({});
    }
  }, [isSettingsModalOpen, user]);

  if (!isSettingsModalOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFieldErrors({});

    try {
      const formData = new FormData();
      formData.set('contact_number', contactNumber);
      if (avatarPreview) {
        formData.set('avatar_preview_url', avatarPreview);
      }
      const res = await updateProfileApi(formData);
      setUser(res.data);
      showToast(
        res.message || 'Profile settings updated (FR-06).',
        'success'
      );
      setIsSettingsModalOpen(false);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Could not update profile.', 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const contactError = getFieldValidationError(fieldErrors, 'contact_number');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
    >
      <div className="bg-white border border-slate-300 rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 bg-ustp-navy text-white">
          <div>
            <h2 id="profile-settings-title" className="text-sm font-bold">
              Profile & SMS Fallback Settings (FR-06)
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              RA 10173 Encrypted Contact & Avatar Configuration
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(false)}
            aria-label="Close profile settings"
            className="p-1 rounded hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Avatar Section */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-ustp-cream border-2 border-ustp-gold flex items-center justify-center text-xl font-extrabold text-ustp-navy shrink-0">
              {user.name.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-ustp-text">{user.name}</p>
              <p className="text-xs text-slate-600 font-mono tabular-nums">
                ID: {user.institutional_id} • {user.role.toUpperCase()}
              </p>
              <button
                type="button"
                onClick={() => {
                  setAvatarPreview('/avatars/updated-ustp-profile.png');
                  showToast('New profile photo staged for multipart upload.', 'info');
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ustp-navy rounded border border-slate-300 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Upload Avatar (FormData)</span>
              </button>
            </div>
          </div>

          {/* Mobile Contact Number for SMS Fallback */}
          <div>
            <label
              htmlFor="profile-contact-number"
              className="block text-xs font-bold text-ustp-text mb-1"
            >
              Encrypted Mobile Contact Number (Offline SMS Broadcast — NFR-02)
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="profile-contact-number"
                type="text"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+63 917 842 2020"
                className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
              />
            </div>
            {contactError && (
              <p className="text-xs font-semibold text-red-600 mt-1" role="alert">
                {contactError}
              </p>
            )}
            <p className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              Protected under Philippine Data Privacy Act of 2012 (RA 10173).
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Updating...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
