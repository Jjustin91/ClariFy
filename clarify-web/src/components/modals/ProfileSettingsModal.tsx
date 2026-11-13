'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, Phone, ShieldCheck, Trash2, X } from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { updateProfileApi } from '../../lib/api-client';
import { getFieldValidationError } from '../../lib/domain-logic';
import type { LaravelValidationError } from '../../types/api';

async function compressAvatarFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Empty image data.'));
        return;
      }
      const img = new window.Image();
      img.onerror = () => resolve(result);
      img.onload = () => {
        const targetSize = 256;
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        // Center-crop square for crisp circular PFP
        const minSide = Math.min(img.width, img.height);
        const sx = Math.max(0, (img.width - minSide) / 2);
        const sy = Math.max(0, (img.height - minSide) / 2);
        ctx.drawImage(
          img,
          sx,
          sy,
          minSide,
          minSide,
          0,
          0,
          targetSize,
          targetSize
        );
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isSettingsModalOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setContactNumber(user.contact_number || '+63 917 842 2020');
      setAvatarPreview(user.avatar_url || null);
      setFieldErrors({});
    } else if (!isSettingsModalOpen) {
      wasOpenRef.current = false;
    }
  }, [isSettingsModalOpen, user.contact_number, user.avatar_url]);

  if (!isSettingsModalOpen) return null;

  const handleAvatarFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file (PNG, JPG, WebP).', 'error');
      return;
    }

    try {
      const dataUrl = await compressAvatarFileToDataUrl(file);
      setAvatarPreview(dataUrl);
      showToast(
        'Profile photo ready! Click Save Profile to apply.',
        'info'
      );
    } catch {
      showToast('Failed to process selected image.', 'error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFieldErrors({});

    try {
      const formData = new FormData();
      formData.set('contact_number', contactNumber);
      formData.set('avatar_preview_url', avatarPreview || '');
      const res = await updateProfileApi(formData);
      setUser(res.data);
      showToast(
        res.message || 'Profile settings updated.',
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
  const avatarInitial = user.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
    >
      <div className="bg-white border border-slate-300 rounded-lg shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-ustp-navy text-white shrink-0">
          <div>
            <h2 id="profile-settings-title" className="text-sm font-bold">
              Profile &amp; SMS Fallback Settings
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              RA 10173 Encrypted Contact &amp; Avatar Configuration
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

        <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-5 flex-1 min-h-0 overflow-y-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarFileChange}
            className="hidden"
            aria-label="Choose profile avatar image"
          />

          {/* Avatar Section */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Click to upload profile picture"
              className="w-16 h-16 rounded-full bg-ustp-cream border-2 border-ustp-gold flex items-center justify-center text-xl font-extrabold text-ustp-navy shrink-0 overflow-hidden relative group cursor-pointer"
            >
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={user.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{avatarInitial}</span>
              )}
              <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Camera className="w-4 h-4" />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ustp-text truncate">
                {user.name}
              </p>
              <p className="text-xs text-slate-600 font-mono tabular-nums">
                ID: {user.institutional_id} • {user.role.toUpperCase()}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ustp-navy rounded border border-slate-300 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Upload Avatar</span>
                </button>
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={() => setAvatarPreview(null)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded border border-red-200 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Contact Number for SMS Fallback */}
          <div>
            <label
              htmlFor="profile-contact-number"
              className="block text-xs font-bold text-ustp-text mb-1"
            >
              Encrypted Mobile Contact Number (Offline SMS Broadcast)
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="profile-contact-number"
                type="text"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+63 917 842 2020"
                className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
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
