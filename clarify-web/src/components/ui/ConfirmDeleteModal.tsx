'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  loadingLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({
  isOpen,
  title,
  description,
  confirmLabel = 'Delete',
  loadingLabel = 'Deleting...',
  cancelLabel = 'Cancel',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-modal-title"
      aria-describedby="confirm-delete-modal-desc"
      onClick={() => {
        if (!isLoading) onCancel();
      }}
    >
      <div
        className="bg-white border border-slate-300 rounded-lg shadow-xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-ustp-navy text-white px-5 py-3.5 flex items-center justify-between border-b-2 border-ustp-gold">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-ustp-gold shrink-0" />
            <h2
              id="confirm-delete-modal-title"
              className="text-sm font-extrabold truncate"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p
            id="confirm-delete-modal-desc"
            className="text-sm text-slate-700 leading-relaxed"
          >
            {description}
          </p>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              disabled={isLoading}
              onClick={onCancel}
              className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={onConfirm}
              className="px-4 py-2 text-xs font-extrabold text-white bg-red-600 hover:bg-red-700 border border-red-700 rounded disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-red-700 cursor-pointer"
            >
              {isLoading ? loadingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
