// 早番・遅番などの勤務区分を編集する部品
import { newShiftTypeId, shiftHours } from '../domain/conditions';
import type { ShiftType } from '../domain/types';

const COLORS = ['#f0b44c', '#4fb3cf', '#5cc4a6', '#ef8fa8', '#9d8fe0', '#f3cf5c'];

export function ShiftTypeEditor({ value, onChange }: { value: ShiftType[]; onChange: (v: ShiftType[]) => void }) {
  const update = (id: string, patch: Partial<ShiftType>) => onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => onChange(value.filter((s) => s.id !== id));
  const add = () =>
    onChange([
      ...value,
      { id: newShiftTypeId(), name: '新しい区分', start: '10:00', end: '18:00', color: COLORS[value.length % COLORS.length] },
    ]);

  return (
    <div className="shift-types">
      {value.map((s) => (
        <div key={s.id} className="shift-type-row">
          <input
            type="color"
            className="color-input"
            value={s.color}
            onChange={(e) => update(s.id, { color: e.target.value })}
            aria-label={`${s.name}の色`}
          />
          <input
            type="text"
            className="shift-name"
            value={s.name}
            onChange={(e) => update(s.id, { name: e.target.value })}
            aria-label="勤務区分の名前"
          />
          <span className="shift-hours">{s.start !== s.end ? `${shiftHours(s)}時間` : ''}</span>
          <button type="button" className="icon-btn" aria-label={`${s.name}を削除`} onClick={() => remove(s.id)}>
            ✕
          </button>
          <div className="shift-time">
            <input type="time" value={s.start} onChange={(e) => update(s.id, { start: e.target.value })} aria-label={`${s.name}の開始時間`} />
            <span>〜</span>
            <input type="time" value={s.end} onChange={(e) => update(s.id, { end: e.target.value })} aria-label={`${s.name}の終了時間`} />
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-ghost" onClick={add}>
        ＋ 勤務区分を追加
      </button>
      <p className="field-hint">※ 勤務時間は休憩を含んだ時間です（休憩の差し引きは今後追加できます）。</p>
    </div>
  );
}
