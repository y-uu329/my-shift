import { describe, expect, it } from 'vitest';
import { DEFAULT_PAY } from './pay';
import { periodMonthOf, periodOf, periodPay, periodsWithData } from './payPeriods';
import type { DayAssignment } from './types';

const w = (date: string): DayAssignment => ({ date, work: true, start: '09:00', end: '17:00' }); // 実働7時間・10,780円

describe('締め日の期間', () => {
  it('末日締めはその月の1日〜末日', () => {
    expect(periodOf('2026-12', 0)).toEqual({ month: '2026-12', start: '2026-12-01', end: '2026-12-31' });
    expect(periodOf('2028-02', 0).end).toBe('2028-02-29');
  });
  it('15日締めの12月分は 11/16〜12/15（年またぎも）', () => {
    expect(periodOf('2026-12', 15)).toEqual({ month: '2026-12', start: '2026-11-16', end: '2026-12-15' });
    expect(periodOf('2027-01', 15)).toEqual({ month: '2027-01', start: '2026-12-16', end: '2027-01-15' });
  });
  it('どの日が何月分か', () => {
    expect(periodMonthOf('2026-12-15', 15)).toBe('2026-12');
    expect(periodMonthOf('2026-12-16', 15)).toBe('2027-01');
    expect(periodMonthOf('2026-12-31', 0)).toBe('2026-12');
  });
  it('25日締めの3月分は 2/26〜3/25（2月の日数に関係なく）', () => {
    expect(periodOf('2027-03', 25)).toEqual({ month: '2027-03', start: '2027-02-26', end: '2027-03-25' });
  });
});

describe('期間の給料', () => {
  const shifts = new Map<string, DayAssignment[]>([
    ['2026-11', [w('2026-11-10'), w('2026-11-20'), { date: '2026-11-21', work: false }]],
    ['2026-12', [w('2026-12-01'), w('2026-12-15'), w('2026-12-20')]],
  ]);

  it('15日締め：11/20・12/1・12/15 の3日分が12月分', () => {
    const p = periodPay('2026-12', shifts, { ...DEFAULT_PAY, closingDay: 15 });
    expect(p.workDays).toBe(3);
    expect(p.workHours).toBe(21);
    expect(p.pay).toBe(32340);
    expect(p.missingMonths).toEqual([]);
  });

  it('末日締め：12月分は12月の3日分', () => {
    expect(periodPay('2026-12', shifts, DEFAULT_PAY).pay).toBe(32340);
  });

  it('シフトがない月がかかっていたら知らせる', () => {
    const p = periodPay('2027-01', shifts, { ...DEFAULT_PAY, closingDay: 15 });
    expect(p.workDays).toBe(1); // 12/20
    expect(p.missingMonths).toEqual(['2027-01']);
  });

  it('データのある期間の一覧', () => {
    expect(periodsWithData(['2026-12', '2026-11'], 15)).toEqual(['2027-01', '2026-12', '2026-11']);
    expect(periodsWithData(['2026-12', '2026-11'], 0)).toEqual(['2026-12', '2026-11']);
  });
});
