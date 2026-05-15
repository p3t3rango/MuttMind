'use client';

import { useEffect, useRef, useState } from 'react';

export type DropdownOption<T extends string> = {
  value: T;
  name: string;
  hint?: string;
  /** Optional tone class suffix (e.g. 'open' / 'private') for semantic colors. */
  tone?: string;
};

type DropdownProps<T extends string> = {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** 'modal' = chunky form-style; 'inline' = compact for nav/toolbars. */
  size?: 'modal' | 'inline';
  /** Extra class on the outer wrapper for one-off positioning tweaks. */
  className?: string;
};

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  ariaLabel,
  size = 'modal',
  className,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const current = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;
    const handleDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!wrapperRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className={`mm-select mm-select--${size}${className ? ` ${className}` : ''}`}
      data-open={open}
    >
      <button
        type="button"
        className={`mm-select__trigger${current?.tone ? ` mm-select__trigger--${current.tone}` : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="mm-select__trigger-label">{current?.name ?? placeholder}</span>
        <span className="mm-select__chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="mm-select__menu" role="listbox">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={value === opt.value}
                className={`mm-select__option${opt.tone ? ` mm-select__option--${opt.tone}` : ''}${value === opt.value ? ' mm-select__option--selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="mm-select__option-name">{opt.name}</span>
                {opt.hint ? <span className="mm-select__option-hint">{opt.hint}</span> : null}
                {value === opt.value ? (
                  <span className="mm-select__option-check" aria-hidden="true">✓</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
