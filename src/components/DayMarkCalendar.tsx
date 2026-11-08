// 日付をタップして「休み希望」「勤務できない」「勤務希望」を付けるミニカレンダー
import { useState } from 'react';
import { DAY_MARK_LABEL, setDayMark } from '../domain/conditions';
import { datesOfMonth, formatDate, WEEKDAY_LABELS, weekdayOf } from '../domain/date';
import type { DayMark, DayMarkKind, ShiftType, YearMonth, FortuneDay, FortunePref } from '../domain/types';
import { PriorityBadge } from './ui';

type Mode = DayMarkKind | 'clear';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'off-request', label: '休み希望' },
  { mode: 'unavailable', label: '勤務できない' },
  { mode: 'work-request', label: '勤務希望' },
  { mode: 'clear', label: '指定を消す' },
];

export function DayMarkCalendar({
  month,
  marks,
  shiftTypes,
  onChange,
  fortunes = [],
  fortunePrefs = {},
}: {
  month: YearMonth;
  marks: DayMark[];
  shiftTypes: ShiftType[];
  onChange: (marks: DayMark[]) => void;
  /** 占いの運気（見ながら休み希望などを決められるように表示する） */
  fortunes?: FortuneDay[];
  fortunePrefs?: Record<string, FortunePref>;
}) {
  const fortuneByDate = new Map(fortunes.map((f) => [f.date, f.label]));
  const [mode, setMode] = useState<Mode>('off-request');
  const byDate = new Map(marks.map((m) => [m.date, m]));
  const dates = datesOfMonth(month);
  // 月曜始まりにするための空白マス
  const leading = (weekdayOf(dates[0]) + 6) % 7;
  const headers = [1, 2, 3, 4, 5, 6, 0];

  const tap = (date: string) => {
    const current = byDate.get(date);
    if (mode === 'clear' || current?.kind === mode) onChange(setDayMark(marks, date, null));
    else onChange(setDayMark(marks, date, mode));
  };

  const update = (date: string, patch: Partial<DayMark>) => {
    onChange(marks.map((m) => (m.date === date ? { ...m, ...patch } : m)));
  };

  return (
    <div>
      <div className="mode-picker" role="radiogroup" aria-label="タップしたときに付ける印">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            className={`mode-btn mode-${m.mode} ${mode === m.mode ? 'active' : ''}`}
            onClick={() => setMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="field-hint">
        上で種類を選んでから日付をタップします。同じ印の日をもう一度タップすると消えます。
      </p>

      <div className="mini-cal" role="grid">
        {headers.map((wd) => (
          <div key={wd} className={`mini-cal-head wd-${wd}`}>
            {WEEKDAY_LABELS[wd]}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {dates.map((date) => {
          const mark = byDate.get(date);
          const wd = weekdayOf(date);
          return (
            <button
              key={date}
              type="button"
              className={`mini-cal-day wd-${wd} ${mark ? `mark-${mark.kind}` : ''}`}
              onClick={() => tap(date)}
              aria-label={`${formatDate(date)} ${fortuneByDate.get(date) ? `運気:${fortuneByDate.get(date)} ` : ''}${mark ? DAY_MARK_LABEL[mark.kind] : '指定なし'}`}
            >
              <span className="mini-cal-num">{Number(date.slice(8))}</span>
              {fortuneByDate.get(date) && (
                <span className={`fortune-chip pref-${fortunePrefs[fortuneByDate.get(date)!] ?? 0}`}>{fortuneByDate.get(date)}</span>
              )}
              {mark && <span className="mini-cal-tag">{shortLabel(mark.kind)}</span>}
            </button>
          );
        })}
      </div>

      <div className="legend">
        <span className="legend-item"><i className="dot mark-unavailable" />勤務できない <PriorityBadge priority="A" /></span>
        <span className="legend-item"><i className="dot mark-off-request" />休み希望 <PriorityBadge priority="B" /></span>
        <span className="legend-item"><i className="dot mark-work-request" />勤務希望 <PriorityBadge priority="B" /></span>
        {fortunes.length > 0 && (
          <span className="legend-item">
            <span className="fortune-chip pref-1">運気</span>出勤したい
            <span className="fortune-chip pref--1">運気</span>休みたい
            <span className="fortune-chip pref-0">運気</span>どちらでも
          </span>
        )}
      </div>

      {marks.length > 0 && (
        <ul className="mark-list">
          {marks.map((m) => (
            <li key={m.date} className="mark-row">
              <span className={`mark-chip mark-${m.kind}`}>{DAY_MARK_LABEL[m.kind]}</span>
              <span className="mark-date">{formatDate(m.date)}</span>
              {m.kind === 'work-request' && (
                <select
                  value={m.shiftTypeId ?? ''}
                  onChange={(e) => update(m.date, { shiftTypeId: e.target.value || undefined })}
                  aria-label="希望する勤務区分"
                >
                  <option value="">区分はおまかせ</option>
                  {shiftTypes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.start}〜{s.end}）
                    </option>
                  ))}
                </select>
              )}
              <input
                className="mark-note"
                type="text"
                placeholder="メモ（任意）"
                value={m.note ?? ''}
                onChange={(e) => update(m.date, { note: e.target.value || undefined })}
              />
              <button type="button" className="icon-btn" aria-label="この指定を消す" onClick={() => onChange(setDayMark(marks, m.date, null))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shortLabel(kind: DayMarkKind) {
  return kind === 'off-request' ? '休希望' : kind === 'unavailable' ? '不可' : '勤希望';
}
