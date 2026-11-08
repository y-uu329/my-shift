// シフトを月間カレンダーで表示する部品（出勤と休みを色分け）
import type { CSSProperties } from 'react';
import { datesOfMonth, durationHours, formatDate, WEEKDAY_LABELS, weekdayOf } from '../domain/date';
import { holidayName } from '../domain/holidays';
import type { DayAssignment, MonthConditions } from '../domain/types';

export function ShiftCalendar({
  conditions,
  days,
  onTapDay,
  selectedDate,
  large = false,
  changedDates,
}: {
  conditions: MonthConditions;
  days: DayAssignment[];
  onTapDay?: (date: string) => void;
  /** 編集中の日（枠で強調） */
  selectedDate?: string;
  /** カレンダー画面用の大きい表示 */
  large?: boolean;
  /** 前の版から変わった日（● を付ける） */
  changedDates?: Set<string>;
}) {
  const month = conditions.month;
  const dates = datesOfMonth(month);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const marks = new Map(conditions.dayMarks.map((m) => [m.date, m]));
  const fortunes = new Map((conditions.fortunes ?? []).map((f) => [f.date, f.label]));
  const types = new Map(conditions.shiftTypes.map((s) => [s.id, s]));
  const leading = (weekdayOf(dates[0]) + 6) % 7;
  const headers = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className={`shift-cal ${large ? 'large' : ''}`} role="grid">
      {headers.map((wd) => (
        <div key={wd} className={`shift-cal-head wd-${wd}`}>
          {WEEKDAY_LABELS[wd]}
        </div>
      ))}
      {Array.from({ length: leading }, (_, i) => (
        <div key={`b${i}`} className="shift-cal-blank" />
      ))}
      {dates.map((date) => {
        const d = byDate.get(date);
        const mark = marks.get(date);
        const type = d?.shiftTypeId ? types.get(d.shiftTypeId) : undefined;
        const holiday = holidayName(date);
        const wd = weekdayOf(date);
        // 希望どおりにならなかった日を目立たせる
        const missed = (mark?.kind === 'off-request' && d?.work) || (mark?.kind === 'work-request' && !d?.work);
        const label = d?.work
          ? `${type?.name ?? '出勤'} ${d.start ?? ''}〜${d.end ?? ''}`
          : '休み';
        return (
          <button
            key={date}
            type="button"
            className={`shift-cell ${d?.work ? 'is-work' : 'is-off'} ${missed ? 'is-missed' : ''} ${selectedDate === date ? 'is-selected' : ''} ${changedDates?.has(date) ? 'is-changed' : ''}`}
            style={d?.work && type ? ({ '--shift-color': type.color } as CSSProperties) : undefined}
            onClick={onTapDay ? () => onTapDay(date) : undefined}
            disabled={!onTapDay}
            aria-label={`${formatDate(date)} ${holiday ?? ''} ${fortunes.get(date) ? `運気:${fortunes.get(date)} ` : ''}${label}${mark ? ` (${markText(mark.kind)}${mark.note ? `：${mark.note}` : ''})` : ''}${d?.locked ? ' 確定' : ''}`}
            aria-pressed={onTapDay ? selectedDate === date : undefined}
          >
            <span className="shift-cell-top">
              <span className={`shift-cell-num wd-${holiday ? 0 : wd}`}>
                {Number(date.slice(8))}
                {d?.locked && <span className="lock" title="確定済み">🔒</span>}
                {changedDates?.has(date) && <span className="changed-dot" title="変更あり">●</span>}
              </span>
              {mark && <span className={`shift-cell-mark mark-${mark.kind}`}>{markText(mark.kind)}</span>}
            </span>
            {holiday && <span className="shift-cell-holiday">{holiday}</span>}
            {fortunes.get(date) && (
              <span className={`shift-cell-fortune pref-${conditions.fortunePrefs?.[fortunes.get(date)!] ?? 0}`}>🔮{fortunes.get(date)}</span>
            )}
            {large && mark?.note && <span className="shift-cell-note">📝 {mark.note}</span>}
            {d?.work ? (
              <span className="shift-cell-body">
                <span className="shift-cell-type">{type?.name ?? '出勤'}</span>
                {d.start && d.end && (
                  <span className="shift-cell-time">
                    {d.start}–{d.end}
                    <small>（{durationHours(d.start, d.end)}h）</small>
                  </span>
                )}
              </span>
            ) : (
              <span className="shift-cell-body off">休み</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function markText(kind: string) {
  return kind === 'off-request' ? '休希望' : kind === 'unavailable' ? '不可' : '勤希望';
}
