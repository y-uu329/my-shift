import { describe, expect, it } from 'vitest';
import { breakMinutesFor, DEFAULT_PAY, dayPay, hm, monthPay } from './pay';
import type { DayAssignment } from './types';

const work = (date: string, start: string, end: string): DayAssignment => ({ date, work: true, start, end });

describe('休憩の判定（6時間以下なし・6時間超60分・8時間超90分）', () => {
  it.each([
    [5, 0],
    [6, 0],
    [6.5, 60],
    [8, 60],
    [8.5, 90],
    [10, 90],
  ])('%s時間 → %s分', (span, minutes) => {
    expect(breakMinutesFor(span, DEFAULT_PAY.breakRules)).toBe(minutes);
  });
});

describe('1日の給料', () => {
  it('9:00〜17:00（8時間）は休憩60分・実働7時間・10,780円', () => {
    expect(dayPay(work('2026-12-01', '09:00', '17:00'), DEFAULT_PAY)).toEqual({ spanHours: 8, breakMinutes: 60, workHours: 7, pay: 10780 });
  });
  it('9:00〜18:00（9時間）は休憩90分・実働7時間30分・11,550円', () => {
    expect(dayPay(work('2026-12-01', '09:00', '18:00'), DEFAULT_PAY)).toEqual({ spanHours: 9, breakMinutes: 90, workHours: 7.5, pay: 11550 });
  });
  it('10:00〜15:00（5時間）は休憩なし・7,700円', () => {
    expect(dayPay(work('2026-12-01', '10:00', '15:00'), DEFAULT_PAY).pay).toBe(7700);
  });
  it('日付をまたぐ勤務 22:00〜7:00（9時間）', () => {
    expect(dayPay(work('2026-12-01', '22:00', '07:00'), DEFAULT_PAY).workHours).toBe(7.5);
  });
  it('休みの日は0円', () => {
    expect(dayPay({ date: '2026-12-01', work: false }, DEFAULT_PAY).pay).toBe(0);
  });
});

describe('月の給料', () => {
  it('実働の合計から計算し、最後に1回だけ四捨五入する', () => {
    const days = [work('2026-12-01', '09:00', '17:00'), work('2026-12-02', '13:00', '21:00'), work('2026-12-03', '10:00', '15:20'), { date: '2026-12-04', work: false }];
    const m = monthPay(days, DEFAULT_PAY);
    // 実働 7h + 7h + 5h20m = 19h20m = 1160分 → 1160 × 1540 ÷ 60 = 29,773.33… → 29,773円
    expect(m).toEqual({ workDays: 3, spanHours: 16 + 16 / 3, breakHours: 2, workHours: 1160 / 60, pay: 29773 });
  });
  it('時給を変えると反映される', () => {
    expect(monthPay([work('2026-12-01', '09:00', '17:00')], { ...DEFAULT_PAY, hourlyWage: 1200 }).pay).toBe(8400);
  });
  it('時間の表示', () => {
    expect(hm(7.5)).toBe('7時間30分');
    expect(hm(7)).toBe('7時間');
  });
});
