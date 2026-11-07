import { useRef } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, ariaLabel,
}: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          className={`seg-item ${value === o.value ? 'on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={`chip ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min = 1, max = 99, onChange }: { value: number; min?: number; max?: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="减少" disabled={value <= min}>−</button>
      <output>{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="增加" disabled={value >= max}>＋</button>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-label">{label}</span>
      <span className="switch-track"><span className="switch-thumb" /></span>
    </button>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 120 70" width="120" height="70" aria-hidden="true" className="empty-art">
        <rect x="4" y="8" width="112" height="54" rx="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" opacity=".55" />
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <rect x={14 + i * 13} y="12" width="6" height="5" rx="1" fill="currentColor" opacity=".4" />
            <rect x={14 + i * 13} y="53" width="6" height="5" rx="1" fill="currentColor" opacity=".4" />
          </g>
        ))}
        <circle cx="60" cy="35" r="10" fill="none" stroke="currentColor" strokeWidth="2" opacity=".55" />
      </svg>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="stars" role={onChange ? 'radiogroup' : 'img'} aria-label={`评分 ${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'on' : ''}
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          aria-label={`${n} 星`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function PhotoInput({ onFile, children }: { onFile: (f: File) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn ghost" onClick={() => ref.current?.click()}>{children}</button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
