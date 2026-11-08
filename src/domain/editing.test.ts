import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_TYPES } from './conditions';
import { createEmptyShift, isValidRange, normalizeDays, setLocked, toCustomTime, toOff, toShiftType, updateDay } from './editing';

describe('手動編集', () => {
  it('空のシフトは全日休み', () => {
    const s = createEmptyShift('2027-02');
    expect(s.days).toHaveLength(28);
    expect(s.days.every((d) => !d.work)).toBe(true);
  });

  it('抜けている日を休みで補う', () => {
    const days = normalizeDays('2026-12', [{ date: '2026-12-05', work: true, start: '09:00', end: '17:00' }]);
    expect(days).toHaveLength(31);
    expect(days[4].work).toBe(true);
    expect(days[0].work).toBe(false);
  });

  it('出勤⇔休み・時間変更で確定の印は残る', () => {
    const day = setLocked({ date: '2026-12-01', work: false }, true);
    const worked = toShiftType(day, DEFAULT_SHIFT_TYPES[1]);
    expect(worked).toMatchObject({ work: true, shiftTypeId: 'late', start: '13:00', end: '21:00', locked: true });
    const custom = toCustomTime(worked, '10:00', '15:30');
    expect(custom).toEqual({ date: '2026-12-01', work: true, start: '10:00', end: '15:30', locked: true });
    expect(toOff(custom)).toEqual({ date: '2026-12-01', work: false, locked: true });
    expect(setLocked(custom, false).locked).toBeUndefined();
  });

  it('1日だけ変更し、元の配列は変えない', () => {
    const s = createEmptyShift('2026-12');
    const next = updateDay(s.days, '2026-12-03', { date: '2026-12-03', work: true });
    expect(next[2].work).toBe(true);
    expect(s.days[2].work).toBe(false);
  });

  it('時間の範囲チェック', () => {
    expect(isValidRange('09:00', '17:00')).toBe(true);
    expect(isValidRange('22:00', '06:00')).toBe(true);
    expect(isValidRange('09:00', '09:00')).toBe(false);
    expect(isValidRange('', '17:00')).toBe(false);
  });
});
