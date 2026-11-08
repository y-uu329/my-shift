// 画面で何度も使う小さな部品
import type { ReactNode } from 'react';
import { PRIORITY_LABEL } from '../domain/conditions';
import type { Priority } from '../domain/types';

/** 優先度の小さなラベル（A / B / C） */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge badge-${priority}`} title={PRIORITY_LABEL[priority]}>
      {priority}・{PRIORITY_LABEL[priority]}
    </span>
  );
}

/** 見出し付きのカード */
export function Section({ title, icon, children }: { title: string; icon?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="card-title">
        {icon && <span aria-hidden>{icon}</span>} {title}
      </h2>
      {children}
    </section>
  );
}

/** 1つの入力項目（ラベル・優先度・説明） */
export function Field({
  label,
  priority,
  hint,
  children,
}: {
  label: string;
  priority?: Priority;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {priority && <PriorityBadge priority={priority} />}
      </div>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/**
 * ー / ＋ ボタンで数を増減する入力欄。
 * allowEmpty のときは「指定なし」（null）にできる。
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  unit,
  allowEmpty = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  allowEmpty?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const base = value ?? min;
  return (
    <div className="stepper">
      <button type="button" className="stepper-btn" aria-label="減らす" disabled={value !== null && value <= min} onClick={() => onChange(clamp(base - step))}>
        −
      </button>
      <input
        className="stepper-input"
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        placeholder={allowEmpty ? '指定なし' : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') onChange(allowEmpty ? null : min);
          else if (!Number.isNaN(Number(raw))) onChange(Number(raw));
        }}
      />
      {unit && <span className="stepper-unit">{unit}</span>}
      <button type="button" className="stepper-btn" aria-label="増やす" disabled={value !== null && value >= max} onClick={() => onChange(value === null ? min : clamp(base + step))}>
        ＋
      </button>
      {allowEmpty && value !== null && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>
          指定なしにする
        </button>
      )}
    </div>
  );
}

/** オン・オフの切り替えスイッチ */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}
