'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Pipette, Check } from 'lucide-react';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  brandColors?: string[];
  description?: string;
}

export function ColorPicker({
  label,
  value,
  onChange,
  brandColors = [],
  description,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value || '#FFFFFF');
  const [prevValue, setPrevValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  if (value !== prevValue) {
    setPrevValue(value);
    setHexInput(value || '#FFFFFF');
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.trim();
    if (!val.startsWith('#') && val.length > 0) {
      val = `#${val}`;
    }
    setHexInput(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onChange(val.toUpperCase());
    }
  };

  const handleNativeColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setHexInput(val);
    onChange(val);
  };

  const handleSelectPalette = (c: string) => {
    const formatted = c.toUpperCase();
    setHexInput(formatted);
    onChange(formatted);
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <div className="flex items-center justify-between text-xs">
        <label className="text-slate-300 font-medium">{label}</label>
        {description && <span className="text-[11px] text-slate-500">{description}</span>}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-lg hover:border-slate-700 transition-all text-xs font-mono"
        >
          <div className="flex items-center space-x-2.5">
            <span
              className="w-5 h-5 rounded-md border border-white/20 shadow-inner shrink-0"
              style={{ backgroundColor: value || '#FFFFFF' }}
            />
            <span className="text-slate-200">{value || '#FFFFFF'}</span>
          </div>
          <Pipette className="h-3.5 w-3.5 text-slate-400" />
        </button>

        {isOpen && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1.5 p-3 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-100">
            {/* Native Color Picker & Input Row */}
            <div className="flex items-center space-x-2.5">
              <div className="relative w-9 h-9 rounded-lg overflow-hidden border border-slate-700 shrink-0 cursor-pointer">
                <input
                  type="color"
                  value={value.startsWith('#') && value.length === 7 ? value : '#FFFFFF'}
                  onChange={handleNativeColorChange}
                  className="absolute -inset-2 w-14 h-14 cursor-pointer border-0 p-0"
                />
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  value={hexInput}
                  maxLength={7}
                  onChange={handleHexChange}
                  placeholder="#FFFFFF"
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Authoritative Brand Palette (if available) */}
            {brandColors.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Brand Palette
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {brandColors.map((c, i) => {
                    const isSelected = (value || '').toUpperCase() === c.toUpperCase();
                    return (
                      <button
                        key={`${c}-${i}`}
                        type="button"
                        onClick={() => handleSelectPalette(c)}
                        title={c}
                        className={`w-6 h-6 rounded-md border flex items-center justify-center transition-all ${
                          isSelected ? 'border-white scale-110 shadow-lg' : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {isSelected && <Check className="h-3 w-3 text-white drop-shadow" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
