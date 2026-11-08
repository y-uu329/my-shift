// カレンダーでの手動編集に使う、小さな計算
import { datesOfMonth, timeToMinutes } from './date';
import type { DateStr, DayAssignment, MonthShift, ShiftType, TimeStr, YearMonth } from './types';

/** すべて休みの空のシフト（手動でいちから作るとき） */
export function createEmptyShift(month: YearMonth): MonthShift {
  const now = new Date().toISOString();
  return {
    version: 1,
    month,
    days: datesOfMonth(month).map((date) => ({ date, work: false })),
    patternName: '手動作成',
    createdAt: now,
    updatedAt: now,
  };
}

/** その月の全日がそろった days を返す（保存データに抜けがあっても安全に扱う） */
export function normalizeDays(month: YearMonth, days: DayAssignment[]): DayAssignment[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return datesOfMonth(month).map((date) => byDate.get(date) ?? { date, work: false });
}

/** 1日分だけ変更した新しい days を返す（元の配列は変えない） */
export function updateDay(days: DayAssignment[], date: DateStr, next: DayAssignment): DayAssignment[] {
  return days.map((d) => (d.date === date ? next : d));
}

export function toOff(day: DayAssignment): DayAssignment {
  return { date: day.date, work: false, ...(day.locked ? { locked: true } : {}) };
}

export function toShiftType(day: DayAssignment, type: ShiftType): DayAssignment {
  return { date: day.date, work: true, shiftTypeId: type.id, start: type.start, end: type.end, ...(day.locked ? { locked: true } : {}) };
}

/** 勤務区分を使わず、時間を直接指定する */
export function toCustomTime(day: DayAssignment, start: TimeStr, end: TimeStr): DayAssignment {
  return { date: day.date, work: true, start, end, ...(day.locked ? { locked: true } : {}) };
}

export function setLocked(day: DayAssignment, locked: boolean): DayAssignment {
  const { locked: _old, ...rest } = day;
  return locked ? { ...rest, locked: true } : rest;
}

/** 開始と終了が同じ時間は勤務として成り立たない */
export function isValidRange(start: TimeStr, end: TimeStr): boolean {
  return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && timeToMinutes(start) !== timeToMinutes(end);
}
