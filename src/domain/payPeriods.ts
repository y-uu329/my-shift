// 給料の締め日で区切った「〇月分」の期間と、その期間の給料
import { addMonths, daysInMonth, parseYearMonth, toDateStr, toYearMonth } from './date';
import { monthPay, type MonthPay, type PaySettings } from './pay';
import type { DateStr, DayAssignment, YearMonth } from './types';

/**
 * 「〇月分」の期間。
 * 末日締め（0）：その月の1日〜末日
 * 15日締め：前の月の16日〜その月の15日
 */
export function periodOf(month: YearMonth, closingDay: number): { month: YearMonth; start: DateStr; end: DateStr } {
  if (!closingDay) return { month, start: toDateStr(month, 1), end: toDateStr(month, daysInMonth(month)) };
  const prev = addMonths(month, -1);
  const startDay = closingDay + 1;
  const start = startDay > daysInMonth(prev) ? toDateStr(month, 1) : toDateStr(prev, startDay);
  return { month, start, end: toDateStr(month, Math.min(closingDay, daysInMonth(month))) };
}

/** その日が「何月分」に入るか */
export function periodMonthOf(date: DateStr, closingDay: number): YearMonth {
  const { year, month } = parseYearMonth(date.slice(0, 7));
  const ym = toYearMonth(year, month);
  if (!closingDay) return ym;
  return Number(date.slice(8)) > closingDay ? addMonths(ym, 1) : ym;
}

/** 期間に含まれるカレンダー上の月（シフトの保存単位） */
export function calendarMonthsIn(start: DateStr, end: DateStr): YearMonth[] {
  const out: YearMonth[] = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

export interface PeriodPay extends MonthPay {
  month: YearMonth;
  start: DateStr;
  end: DateStr;
  /** 期間の中で、シフトが保存されていないカレンダー上の月（その分は0円として計算） */
  missingMonths: YearMonth[];
  /** 期間の中の出勤日（給料の内訳用） */
  days: DayAssignment[];
}

/**
 * 締め日で区切った期間の給料を計算する。
 * shifts：カレンダー上の月 → その月に保存したシフトの days
 */
export function periodPay(month: YearMonth, shifts: Map<YearMonth, DayAssignment[]>, pay: PaySettings): PeriodPay {
  const { start, end } = periodOf(month, pay.closingDay ?? 0);
  const months = calendarMonthsIn(start, end);
  const days = months.flatMap((m) => shifts.get(m) ?? []).filter((d) => d.date >= start && d.date <= end);
  return { month, start, end, missingMonths: months.filter((m) => !shifts.has(m)), days, ...monthPay(days, pay) };
}

/** 保存しているシフトがかかっている「〇月分」の一覧（新しい順） */
export function periodsWithData(shiftMonths: YearMonth[], closingDay: number): YearMonth[] {
  const set = new Set<YearMonth>();
  for (const m of shiftMonths) {
    set.add(periodMonthOf(toDateStr(m, 1), closingDay));
    set.add(periodMonthOf(toDateStr(m, daysInMonth(m)), closingDay));
  }
  return [...set].sort().reverse();
}
