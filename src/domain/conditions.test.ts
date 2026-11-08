import { describe, expect, it } from 'vitest';
import { copyConditionsToMonth, countWorkableDays, createDefaultConditions, fitsWithin, setDayMark, validateConditions } from './conditions';
import { addMonths, daysInMonth, durationHours, weekdayOf, weeksOfMonth } from './date';

describe('日付の道具', () => {
  it('月の前後を正しく計算する（年またぎ含む）', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-05', -13)).toBe('2025-04');
  });
  it('月の日数（うるう年含む）', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(daysInMonth('2026-12')).toBe(31);
  });
  it('曜日を判定する', () => {
    expect(weekdayOf('2026-12-25')).toBe(5); // 金曜日
  });
  it('日付をまたぐ勤務時間', () => {
    expect(durationHours('09:00', '17:30')).toBe(8.5);
    expect(durationHours('22:00', '06:00')).toBe(8);
  });
  it('週を月曜始まりで分ける', () => {
    const weeks = weeksOfMonth('2026-12'); // 12/1 は火曜
    expect(weeks[0][0]).toBe('2026-12-01');
    expect(weeks[1][0]).toBe('2026-12-07');
    expect(weeks.flat()).toHaveLength(31);
  });
});

describe('前月の条件コピー', () => {
  it('いつもの設定は引き継ぎ、日付の指定は引き継がない', () => {
    const prev = createDefaultConditions('2026-11');
    prev.monthlyDays = 20;
    prev.maxConsecutiveDays = 4;
    prev.dayMarks = [{ date: '2026-11-03', kind: 'off-request' }];
    prev.fortunes = [{ date: '2026-11-03', label: '開運' }];
    prev.fortunePrefs = { 開運: 1 };
    const next = copyConditionsToMonth(prev, '2026-12');
    expect(next.month).toBe('2026-12');
    expect(next.monthlyDays).toBe(20);
    expect(next.maxConsecutiveDays).toBe(4);
    expect(next.dayMarks).toEqual([]);
    expect(next.fortunes).toEqual([]);
    expect(next.fortunePrefs).toEqual({ 開運: 1 });
    // 元のデータは変わらない
    expect(prev.dayMarks).toHaveLength(1);
  });
  it('希望日数が月の日数を超える場合は収める', () => {
    const prev = createDefaultConditions('2027-01');
    prev.monthlyDays = 31;
    expect(copyConditionsToMonth(prev, '2027-02').monthlyDays).toBe(28);
  });
});

describe('日付の指定', () => {
  it('同じ日には1種類だけ付く', () => {
    let marks = setDayMark([], '2026-12-05', 'off-request');
    marks = setDayMark(marks, '2026-12-05', 'work-request');
    expect(marks).toEqual([{ date: '2026-12-05', kind: 'work-request' }]);
    expect(setDayMark(marks, '2026-12-05', null)).toEqual([]);
  });
  it('日付順に並ぶ', () => {
    let marks = setDayMark([], '2026-12-20', 'off-request');
    marks = setDayMark(marks, '2026-12-03', 'unavailable');
    expect(marks.map((m) => m.date)).toEqual(['2026-12-03', '2026-12-20']);
  });
});

describe('入力チェック', () => {
  it('初期値はエラーなし', () => {
    expect(validateConditions(createDefaultConditions('2026-12')).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('範囲外の数はエラー', () => {
    const c = createDefaultConditions('2026-12');
    c.monthlyDays = 40;
    c.weeklyDays = 8;
    c.maxConsecutiveDays = 0;
    const fields = validateConditions(c).filter((i) => i.level === 'error').map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['monthlyDays', 'weeklyDays', 'maxConsecutiveDays']));
  });
  it('出勤できる日より希望日数が多いと注意を出す', () => {
    const c = createDefaultConditions('2026-12');
    c.availableWeekdays = [false, true, true, true, true, true, false]; // 平日のみ → 23日
    c.dayMarks = [{ date: '2026-12-01', kind: 'unavailable' }];
    expect(countWorkableDays(c)).toBe(22);
    c.monthlyDays = 25;
    expect(validateConditions(c).some((i) => i.field === 'monthlyDays' && i.level === 'warning')).toBe(true);
  });
  it('連勤上限と週の日数の矛盾に注意を出す', () => {
    const c = createDefaultConditions('2026-12');
    c.maxConsecutiveDays = 2; // 7日間で最大5日
    c.weeklyDays = 6;
    expect(validateConditions(c).some((i) => i.field === 'weeklyDays')).toBe(true);
    c.weeklyDays = 5;
    expect(validateConditions(c).some((i) => i.field === 'weeklyDays')).toBe(false);
  });
  it('勤務区分が時間帯からはみ出すと注意を出す', () => {
    expect(fitsWithin('09:00', '17:00', '09:00', '21:00')).toBe(true);
    expect(fitsWithin('08:00', '17:00', '09:00', '21:00')).toBe(false);
    expect(fitsWithin('23:00', '05:00', '20:00', '08:00')).toBe(true);
  });
});
