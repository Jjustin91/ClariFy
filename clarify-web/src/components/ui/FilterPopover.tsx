'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';

export interface SingleSelectFilterSection {
  kind: 'single';
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  activeTone?: 'navy' | 'blue';
  options: {
    value: string;
    label: string;
    badge?: string;
    highlight?: 'amber';
  }[];
}

export interface ToggleFilterSection {
  kind: 'toggle';
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  optionLabel: string;
  hasAlert?: boolean;
}

export type FilterSection = SingleSelectFilterSection | ToggleFilterSection;

export interface FilterPopoverProps {
  label?: string;
  title?: string;
  activeCount: number;
  sections: FilterSection[];
  onReset?: () => void;
  align?: 'left' | 'right';
  ariaLabel?: string;
  triggerClassName?: string;
}

interface FloatingCoords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function FilterPopover({
  label = 'Filter',
  title = 'Filter Options',
  activeCount,
  sections,
  onReset,
  align = 'right',
  ariaLabel,
  triggerClassName = '',
}: FilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<FloatingCoords | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const computeCoords = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === 'undefined') return;

    const rect = triggerEl.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const margin = 12;
    const panelWidth = Math.min(384, viewportW - margin * 2);
    const gap = 8;

    let left =
      align === 'right' ? rect.right - panelWidth : rect.left;
    left = Math.max(margin, Math.min(left, viewportW - panelWidth - margin));

    const spaceBelow = viewportH - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const estimatedHeight = Math.min(440, Math.max(220, spaceBelow));

    let top = rect.bottom + gap;
    let maxHeight = Math.max(180, Math.min(460, spaceBelow));

    if (spaceBelow < 240 && spaceAbove > spaceBelow) {
      maxHeight = Math.max(180, Math.min(460, spaceAbove));
      const actualHeight = Math.min(
        panelRef.current?.offsetHeight || estimatedHeight,
        maxHeight
      );
      top = Math.max(margin, rect.top - gap - actualHeight);
    }

    setCoords({ top, left, width: panelWidth, maxHeight });
  }, [align]);

  useEffect(() => {
    if (!isOpen) return;

    computeCoords();
    const rafId = window.requestAnimationFrame(computeCoords);

    const handleReposition = () => computeCoords();
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, computeCoords]);

  const isHighlighted = isOpen || activeCount > 0;

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={
          ariaLabel ||
          (activeCount > 0
            ? `${label} (${activeCount} active)`
            : label)
        }
        className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-ustp-navy ${
          isHighlighted
            ? 'bg-ustp-navy text-ustp-gold border-ustp-navy shadow-xs'
            : 'bg-white text-ustp-text border-slate-300 hover:bg-slate-50 shadow-2xs'
        } ${triggerClassName}`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-extrabold tabular-nums bg-ustp-gold text-ustp-navy">
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel || title}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
            className="z-50 flex flex-col bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Floating Tab Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-ustp-navy text-white shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <SlidersHorizontal className="w-4 h-4 text-ustp-gold shrink-0" />
                <span className="text-xs font-extrabold tracking-wide uppercase truncate">
                  {title}
                </span>
                {activeCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-mono font-extrabold tabular-nums bg-ustp-gold text-ustp-navy">
                    {activeCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {activeCount > 0 && onReset && (
                  <button
                    type="button"
                    onClick={() => {
                      onReset();
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold text-ustp-gold hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    triggerRef.current?.focus();
                  }}
                  aria-label="Close filter options"
                  className="p-1 rounded text-slate-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Filter Sections */}
            <div className="p-4 space-y-4 overflow-y-auto overscroll-contain">
              {sections.map((section, idx) => (
                <div
                  key={section.id}
                  className={
                    idx > 0 ? 'pt-3.5 border-t border-slate-100 space-y-2' : 'space-y-2'
                  }
                >
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                    {section.label}
                  </p>

                  {section.kind === 'single' ? (
                    <div
                      role="group"
                      aria-label={section.label}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      {section.options.map((opt) => {
                        const active = section.value === opt.value;
                        const activeStyle =
                          section.activeTone === 'blue'
                            ? 'bg-ustp-blue text-white border-ustp-blue'
                            : 'bg-ustp-navy text-ustp-gold border-ustp-navy';
                        const inactiveStyle =
                          opt.highlight === 'amber'
                            ? 'bg-amber-100 text-amber-950 border-amber-400 hover:bg-amber-200'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300';

                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => section.onChange(opt.value)}
                            aria-pressed={active}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors tabular-nums cursor-pointer focus-visible:outline-2 focus-visible:outline-ustp-navy ${
                              active ? activeStyle : inactiveStyle
                            }`}
                          >
                            <span>{opt.label}</span>
                            {opt.badge && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-ustp-gold text-ustp-navy">
                                {opt.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={section.onToggle}
                      aria-pressed={section.checked}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-colors tabular-nums cursor-pointer focus-visible:outline-2 focus-visible:outline-ustp-navy ${
                        section.checked
                          ? 'bg-red-700 text-white border-red-700'
                          : section.hasAlert
                          ? 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-2 h-2 rounded-full ${
                          section.checked
                            ? 'bg-white'
                            : section.hasAlert
                            ? 'bg-red-600'
                            : 'bg-slate-400'
                        }`}
                      />
                      <span>{section.optionLabel}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
