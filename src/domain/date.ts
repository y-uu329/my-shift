// 日付まわりの小さな道具。タイムゾーンのずれを防ぐため、文字列と「年・月・日」の数値だけで扱う。
import type { DateStr, TimeStr, YearMonth } from './types';

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function toYearMonth(year: number, month1: number): YearMonth {
  return `${year}-${pad(month1)}`;
}

export function parseYearMonth(ym: YearMonth): { year: number; month: number } {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

/** 月を n か月ずらす（n=-1 で前月） */
export function addMonths(ym: YearMonth, n: number): YearMonth {
  const { year, month } = parseYearMonth(ym);
  const index = year * 12 + (month - 1) + n;
  return toYearMonth(Math.floor(index / 12), (index % 12) + 1);
}

export function currentYearMonth(now = new Date()): YearMonth {
  return toYearMonth(now.getFullYear(), now.getMonth() + 1);
}

export function daysInMonth(ym: YearMonth): number {
  const { year, month } = parseYearMonth(ym);
  return new Date(year, month, 0).getDate();
}

export function toDateStr(ym: YearMonth, day: number): DateStr {
  return `${ym}-${pad(day)}`;
}

/** その月のすべての日付 */
export function datesOfMonth(ym: YearMonth): DateStr[] {
  return Array.from({ length: daysInMonth(ym) }, (_, i) => toDateStr(ym, i + 1));
}

/** 曜日 0=日 … 6=土 */
export function weekdayOf(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function isInMonth(date: DateStr, ym: YearMonth): boolean {
  return date.startsWith(`${ym}-`) && Number(date.slice(8)) <= daysInMonth(ym);
}

export function formatYearMonth(ym: YearMonth): string {
  const { year, month } = parseYearMonth(ym);
  return `${year}年${month}月`;
}

export function formatDate(date: DateStr): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

/** "09:30" → 570（分） */
export function timeToMinutes(t: TimeStr): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 勤務時間（時間）。終了が開始より前なら日付をまたぐ勤務として計算 */
export function durationHours(start: TimeStr, end: TimeStr): number {
  let diff = timeToMinutes(end) - timeToMinutes(start);
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

/** その月を何週に分けるか（月曜始まり、月をまたぐ週も1週として数える） */
export function weeksOfMonth(ym: YearMonth): DateStr[][] {
  const weeks: DateStr[][] = [];
  let current: DateStr[] = [];
  for (const date of datesOfMonth(ym)) {
    if (weekdayOf(date) === 1 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(date);
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}
