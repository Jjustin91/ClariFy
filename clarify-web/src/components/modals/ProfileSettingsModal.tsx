'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, Phone, ShieldCheck, Trash2, X } from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { API_BASE_URL, updateProfileApi } from '../../lib/api-client';
import {
  getFieldValidationError,
  getUserInitials,
  normalizePhilippineMobileNumber,
  resolveAvatarDisplayUrl,
  validateProfileAvatarFile,
} from '../../lib/domain-logic';
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
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(
    null
  );
  const [localObjectUrl, setLocalObjectUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);

  const revokeLocalPreview = (url: string | null) => {
    if (url && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors
      }
    }
  };

  useEffect(() => {
    if (isSettingsModalOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setContactNumber(user.contact_number || '');
      setSelectedAvatarFile(null);
      setLocalObjectUrl((prev) => {
        revokeLocalPreview(prev);
        return null;
      });
      setRemoveAvatar(false);
      setAvatarLoadFailed(false);
      setFieldErrors({});
    } else if (!isSettingsModalOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      setSelectedAvatarFile(null);
      setLocalObjectUrl((prev) => {
        revokeLocalPreview(prev);
        return null;
      });
    }
  }, [isSettingsModalOpen, user.contact_number, user.avatar_url]);

  useEffect(() => {
    return () => {
      revokeLocalPreview(localObjectUrl);
    };
  }, [localObjectUrl]);

  if (!isSettingsModalOpen) return null;

  const savedAvatarUrl = resolveAvatarDisplayUrl(user.avatar_url, API_BASE_URL);
  const effectivePreviewUrl = localObjectUrl
    ? localObjectUrl
    : removeAvatar
    ? null
    : savedAvatarUrl;

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateProfileAvatarFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    if (!validation.valid) {
      setFieldErrors((prev) => ({
        ...prev,
        avatar: [validation.error],
      }));
      showToast(validation.error, 'error');
      return;
    }

    const nextObjectUrl = URL.createObjectURL(file);
    setLocalObjectUrl((prev) => {
      revokeLocalPreview(prev);
      return nextObjectUrl;
    });
    setSelectedAvatarFile(file);
    setRemoveAvatar(false);
    setAvatarLoadFailed(false);
    setFieldErrors((prev) => {
      if (!prev.avatar) return prev;
      const next = { ...prev };
      delete next.avatar;
      return next;
    });
    showToast(
      'Profile photo ready! Click Save Profile to upload.',
      'info'
    );
  };

  const handleRemoveAvatar = () => {
    setSelectedAvatarFile(null);
    setLocalObjectUrl((prev) => {
      revokeLocalPreview(prev);
      return null;
    });
    setRemoveAvatar(true);
    setAvatarLoadFailed(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const trimmedContact = contactNumber.trim();
    let normalizedPhone = '';
    if (trimmedContact !== '') {
      const normalized = normalizePhilippineMobileNumber(trimmedContact);
      if (!normalized) {
        setFieldErrors({
          contact_number: [
            'Please enter a valid Philippine mobile number (e.g., +639171234567 or 09171234567).',
          ],
        });
        return;
      }
      normalizedPhone = normalized;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set('contact_number', normalizedPhone);
      if (selectedAvatarFile) {
        formData.set('avatar', selectedAvatarFile, selectedAvatarFile.name);
      } else if (removeAvatar) {
        formData.set('remove_avatar', '1');
        formData.set('avatar_preview_url', '');
      }
      const res = await updateProfileApi(formData);
      setUser(res.data);
      showToast(res.message || 'Profile settings updated.', 'success');
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
  const avatarError = getFieldValidationError(fieldErrors, 'avatar');
  const avatarInitials = getUserInitials(user.name);

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
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAvatarFileChange}
            className="hidden"
            aria-label="Choose profile avatar image"
          />

          {/* Avatar Section */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Click to upload profile picture"
                className="w-16 h-16 rounded-full bg-ustp-cream border-2 border-ustp-gold flex items-center justify-center text-xl font-extrabold text-ustp-navy shrink-0 overflow-hidden relative group cursor-pointer"
              >
                {effectivePreviewUrl && !avatarLoadFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={effectivePreviewUrl}
                    alt={user.name}
                    onError={() => setAvatarLoadFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{avatarInitials}</span>
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
                  {effectivePreviewUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded border border-red-200 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            {avatarError && (
              <p className="text-xs font-semibold text-red-600" role="alert">
                {avatarError}
              </p>
            )}
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
                type="tel"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="+63 9XX XXX XXXX"
                className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white text-ustp-text border border-slate-300 rounded focus:outline-none focus:border-ustp-navy"
              />
            </div>
            {contactError && (
              <p className="text-xs font-semibold text-red-600 mt-1" role="alert">
                {contactError}
              </p>
            )}
            <p className="text-[11px] text-slate-600 mt-1.5">
              Urgent SMS alerts require a real Philippine mobile number (e.g., <span className="font-mono tabular-nums">+639XXXXXXXXX</span> or <span className="font-mono tabular-nums">09XXXXXXXXX</span>).
            </p>
            <p className="text-[11px] text-slate-600 mt-1 flex items-center gap-1">
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
