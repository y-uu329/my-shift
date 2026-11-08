// 給料の計算（時給 × 実働時間）。休憩は「開始〜終了」の長さに応じて差し引く
import { durationHours } from './date';
import type { DayAssignment } from './types';

/** 「開始〜終了の長さが overHours 時間を超えたら、minutes 分の休憩」 */
export interface BreakRule {
  overHours: number;
  minutes: number;
}

export interface PaySettings {
  /** 時給（円） */
  hourlyWage: number;
  breakRules: BreakRule[];
  /** 給料の締め日（1〜28日。0 は末日締め） */
  closingDay?: number;
}

/** 初期値：時給1540円・6時間を超えたら60分・8時間を超えたら90分（6時間以下は休憩なし） */
export const DEFAULT_PAY: PaySettings = {
  hourlyWage: 1540,
  breakRules: [
    { overHours: 8, minutes: 90 },
    { overHours: 6, minutes: 60 },
  ],
  closingDay: 0,
};

/** 開始〜終了の長さ（時間）から、休憩（分）を決める */
export function breakMinutesFor(spanHours: number, rules: BreakRule[]): number {
  const sorted = [...rules].sort((a, b) => b.overHours - a.overHours);
  return sorted.find((r) => spanHours > r.overHours + 1e-9)?.minutes ?? 0;
}

export interface DayPay {
  /** 開始〜終了の長さ（時間） */
  spanHours: number;
  breakMinutes: number;
  /** 実働時間（休憩を引いた時間） */
  workHours: number;
  /** その日の給料（円・1円未満は四捨五入） */
  pay: number;
}

export function dayPay(day: DayAssignment, s: PaySettings): DayPay {
  if (!day.work || !day.start || !day.end) return { spanHours: 0, breakMinutes: 0, workHours: 0, pay: 0 };
  const spanHours = durationHours(day.start, day.end);
  const breakMinutes = breakMinutesFor(spanHours, s.breakRules);
  const workMinutes = Math.max(0, Math.round(spanHours * 60) - breakMinutes);
  return { spanHours, breakMinutes, workHours: workMinutes / 60, pay: Math.round((workMinutes * s.hourlyWage) / 60) };
}

export interface MonthPay {
  workDays: number;
  spanHours: number;
  breakHours: number;
  workHours: number;
  /** 月の給料（円）。実働の合計分数 × 時給 ÷ 60 を最後に1回だけ四捨五入する */
  pay: number;
}

export function monthPay(days: DayAssignment[], s: PaySettings): MonthPay {
  let workDays = 0;
  let spanMinutes = 0;
  let breakMinutes = 0;
  let workMinutes = 0;
  for (const d of days) {
    if (!d.work) continue;
    workDays++;
    if (!d.start || !d.end) continue;
    const p = dayPay(d, s);
    spanMinutes += Math.round(p.spanHours * 60);
    breakMinutes += p.breakMinutes;
    workMinutes += Math.round(p.workHours * 60);
  }
  return {
    workDays,
    spanHours: spanMinutes / 60,
    breakHours: breakMinutes / 60,
    workHours: workMinutes / 60,
    pay: Math.round((workMinutes * s.hourlyWage) / 60),
  };
}

export const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
/** 7.5 → "7時間30分" */
export function hm(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
