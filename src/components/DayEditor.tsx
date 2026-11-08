// カレンダーで選んだ1日を編集するパネル
import { useEffect, useState } from 'react';
import { DAY_MARK_LABEL, fitsWithin } from '../domain/conditions';
import { durationHours, formatDate, weekdayOf } from '../domain/date';
import { isValidRange, setLocked, toCustomTime, toOff, toShiftType } from '../domain/editing';
import { holidayName } from '../domain/holidays';
import { dayPay, hm, yen } from '../domain/pay';
import { useSettings } from '../settingsContext';
import type { DayAssignment, MonthConditions } from '../domain/types';
import { Toggle } from './ui';

export function DayEditor({
  day,
  conditions,
  onChange,
  onPrev,
  onNext,
  onClose,
}: {
  day: DayAssignment;
  conditions: MonthConditions;
  onChange: (next: DayAssignment) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const pay = dayPay(day, settings.pay);
  const isCustom = day.work && !day.shiftTypeId;
  const [start, setStart] = useState(day.start ?? conditions.shiftTypes[0]?.start ?? '09:00');
  const [end, setEnd] = useState(day.end ?? conditions.shiftTypes[0]?.end ?? '17:00');

  // 別の日を選んだら、時間の入力欄をその日の値に戻す
  useEffect(() => {
    setStart(day.start ?? conditions.shiftTypes[0]?.start ?? '09:00');
    setEnd(day.end ?? conditions.shiftTypes[0]?.end ?? '17:00');
  }, [day.date, day.start, day.end, conditions.shiftTypes]);

  const mark = conditions.dayMarks.find((m) => m.date === day.date);
  const holiday = holidayName(day.date);
  const warnings: string[] = [];
  if (day.work) {
    if (mark?.kind === 'unavailable') warnings.push('勤務できない日に指定されている日です');
    if (!conditions.availableWeekdays[weekdayOf(day.date)]) warnings.push('出勤できない曜日です');
    if (day.start && day.end && !fitsWithin(day.start, day.end, conditions.workStart, conditions.workEnd)) {
      warnings.push(`勤務できる時間帯（${conditions.workStart}〜${conditions.workEnd}）の外です`);
    }
    if (mark?.kind === 'off-request') warnings.push('休み希望の日です');
  }

  const applyCustom = (s: string, e: string) => {
    setStart(s);
    setEnd(e);
    if (isValidRange(s, e)) onChange(toCustomTime(day, s, e));
  };

  return (
    <div className="day-editor" role="region" aria-label={`${formatDate(day.date)}の編集`}>
      <div className="day-editor-head">
        <button type="button" className="icon-btn big" aria-label="前の日" onClick={onPrev} disabled={!onPrev}>
          ‹
        </button>
        <div className="day-editor-title">
          <strong>{formatDate(day.date)}</strong>
          {holiday && <span className="holiday-tag">{holiday}</span>}
        </div>
        <button type="button" className="icon-btn big" aria-label="次の日" onClick={onNext} disabled={!onNext}>
          ›
        </button>
        <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
          ✕
        </button>
      </div>

      {mark && (
        <p className={`mark-chip mark-${mark.kind} day-editor-mark`}>
          {DAY_MARK_LABEL[mark.kind]}
          {mark.note ? `：${mark.note}` : ''}
        </p>
      )}

      <div className="choice-grid" role="radiogroup" aria-label="勤務の種類">
        <button type="button" role="radio" aria-checked={!day.work} className={`choice ${!day.work ? 'active off' : ''}`} onClick={() => onChange(toOff(day))}>
          <span className="choice-name">休み</span>
        </button>
        {conditions.shiftTypes.map((s) => {
          const active = day.work && day.shiftTypeId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`choice ${active ? 'active' : ''}`}
              style={{ ['--shift-color' as string]: s.color }}
              onClick={() => onChange(toShiftType(day, s))}
            >
              <span className="choice-name">
                <i className="dot" style={{ background: s.color }} /> {s.name}
              </span>
              <span className="choice-time">
                {s.start}〜{s.end}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          className={`choice ${isCustom ? 'active' : ''}`}
          onClick={() => applyCustom(start, end)}
        >
          <span className="choice-name">時間を指定</span>
          <span className="choice-time">自由に入力</span>
        </button>
      </div>

      {isCustom && (
        <div className="custom-time">
          <input id="custom-start" type="time" value={start} onChange={(e) => applyCustom(e.target.value, end)} aria-label="開始時間" />
          <span>〜</span>
          <input id="custom-end" type="time" value={end} onChange={(e) => applyCustom(start, e.target.value)} aria-label="終了時間" />
          <span className="muted">{isValidRange(start, end) ? `${durationHours(start, end)}時間` : '開始と終了を別の時間にしてください'}</span>
        </div>
      )}

      {day.work && day.start && day.end && (
        <p className="day-pay">
          休憩{pay.breakMinutes}分・実働{hm(pay.workHours)}・<strong>{yen(pay.pay)}</strong>
        </p>
      )}

      {warnings.map((w) => (
        <p key={w} className="issue issue-warning">
          ⚠️ {w}（変更は保存されています）
        </p>
      ))}

      <div className="day-editor-lock">
        <Toggle checked={!!day.locked} onChange={(v) => onChange(setLocked(day, v))} label="🔒 確定（作り直しても変えない日）" />
      </div>
    </div>
  );
}
