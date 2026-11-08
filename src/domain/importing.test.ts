import { describe, expect, it } from 'vitest';
import { createDefaultConditions } from './conditions';
import { createEmptyShift } from './editing';
import { applyRows, batchDuplicates, blockingIssues, existingConflict, isRealDate, normalizeTime, toRows, type MonthData, type ReadEntry, type ReadResult } from './importing';

const entry = (p: Partial<ReadEntry>): ReadEntry => ({
  date: '2026-12-05',
  raw_date: '5',
  status: 'work',
  start: '09:00',
  end: '17:00',
  title: '',
  confidence: 'high',
  problem: null,
  ...p,
});
const result = (entries: ReadEntry[]): ReadResult => ({ year_month: '2026-12', entries, unreadable: [] });

describe('読み取り結果を確認用の行にする', () => {
  it('シフト表：出勤・休みを確定の行にする', () => {
    const rows = toRows('shift', result([entry({}), entry({ date: '2026-12-06', status: 'off', start: null, end: null })]), '1枚目');
    expect(rows.map((r) => [r.action, r.include, r.start, r.warning])).toEqual([
      ['shift-work', true, '09:00', null],
      ['shift-off', true, '', null],
    ]);
  });

  it('読めなかった日付・時間・自信のない行は ⚠️ を付け、日付がなければ登録しない', () => {
    const rows = toRows('shift', result([entry({ date: null, raw_date: '1?' }), entry({ start: '9時', confidence: 'low', problem: '文字がかすれている' })]), '2枚目');
    expect(rows[0].include).toBe(false);
    expect(rows[0].warning).toContain('日付が読み取れませんでした（画像の文字：「1?」）');
    expect(rows[1].warning).toContain('勤務時間が読み取れませんでした');
    expect(rows[1].warning).toContain('自信がありません');
    expect(rows[1].warning).toContain('文字がかすれている');
  });

  it('勤務希望表：休み・出勤可能・不可を振り分け、時間はメモに残す', () => {
    const rows = toRows('wish', result([entry({ status: 'off', start: null, end: null }), entry({ date: '2026-12-07', status: 'available', start: '10:00', end: '18:00' }), entry({ date: '2026-12-08', status: 'unavailable', start: null, end: null })]), '1枚目');
    expect(rows.map((r) => [r.action, r.note])).toEqual([
      ['off-request', ''],
      ['work-request', '10:00〜18:00'],
      ['unavailable', ''],
    ]);
  });

  it('予定表：予定は「勤務できない・予定」にして、予定名と時間をメモに', () => {
    const [row] = toRows('calendar', result([entry({ status: 'event', title: '歯医者', start: '14:00', end: '15:00' })]), '1枚目');
    expect(row).toMatchObject({ action: 'unavailable', note: '歯医者 14:00〜15:00', include: true });
  });

  it('日付・時刻の正規化', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(normalizeTime('9:30')).toBe('09:30');
    expect(normalizeTime('25:00')).toBe('');
  });
});

describe('重複の確認（勝手に上書きしない）', () => {
  it('取り込む行どうしで同じ日付が重なると登録できない', () => {
    const rows = [...toRows('wish', result([entry({ status: 'off' })]), '1枚目'), ...toRows('wish', result([entry({ status: 'unavailable' })]), '2枚目')];
    expect(batchDuplicates(rows).get(rows[0].id)).toEqual(['2枚目']);
    expect(blockingIssues(rows, new Map()).join()).toContain('同じ日付の行が重なっています');
    rows[1].include = false;
    expect(blockingIssues(rows, new Map())).toEqual([]);
  });

  it('登録済みの休み希望と重なると、選ぶまで登録できない', () => {
    const c = createDefaultConditions('2026-12');
    c.dayMarks = [{ date: '2026-12-05', kind: 'work-request' }];
    const data = new Map<string, MonthData>([['2026-12', { conditions: c }]]);
    const rows = toRows('wish', result([entry({ status: 'off', start: null, end: null })]), '1枚目');
    expect(existingConflict(rows[0], data.get('2026-12'))).toContain('登録済み：勤務希望');
    expect(blockingIssues(rows, data).join()).toContain('「新しい内容にする」か「今のままにする」');
    rows[0].resolution = 'keep';
    expect(blockingIssues(rows, data)).toEqual([]);
    const res = applyRows(rows, data, createDefaultConditions);
    expect(res.kept).toBe(1);
    expect(res.updates.size).toBe(0);
  });

  it('同じ内容がすでにあるなら重複扱いにしない', () => {
    const shift = createEmptyShift('2026-12');
    shift.days[4] = { date: '2026-12-05', work: true, start: '09:00', end: '17:00', locked: true };
    const rows = toRows('shift', result([entry({})]), '1枚目');
    expect(existingConflict(rows[0], { shift })).toBeNull();
  });
});

describe('登録', () => {
  it('シフト表は🔒確定の日として登録し、勤務区分の時間が合えば区分も付ける', () => {
    const c = createDefaultConditions('2026-12');
    const data = new Map<string, MonthData>([['2026-12', { conditions: c }]]);
    const rows = toRows('shift', result([entry({}), entry({ date: '2026-12-06', status: 'off', start: null, end: null }), entry({ date: '2026-12-07', start: '10:00', end: '15:00' })]), '1枚目');
    const res = applyRows(rows, data, createDefaultConditions);
    const shift = res.updates.get('2026-12')!.shift!;
    expect(res.shiftDays).toBe(3);
    expect(shift.days[4]).toEqual({ date: '2026-12-05', work: true, start: '09:00', end: '17:00', locked: true, shiftTypeId: 'early' });
    expect(shift.days[5]).toEqual({ date: '2026-12-06', work: false, locked: true });
    expect(shift.days[6]).toEqual({ date: '2026-12-07', work: true, start: '10:00', end: '15:00', locked: true });
    expect(shift.days[0]).toEqual({ date: '2026-12-01', work: false });
  });

  it('「新しい内容にする」を選ぶと上書きし、条件がない月は作る', () => {
    const c = createDefaultConditions('2026-12');
    c.dayMarks = [{ date: '2026-12-05', kind: 'work-request' }];
    const data = new Map<string, MonthData>([['2026-12', { conditions: c }]]);
    const rows = [
      ...toRows('calendar', result([entry({ status: 'event', title: '通院', start: null, end: null })]), '1枚目'),
      ...toRows('calendar', result([entry({ date: '2027-01-04', status: 'event', title: '旅行', start: null, end: null })]), '2枚目'),
    ];
    rows[0].resolution = 'replace';
    const res = applyRows(rows, data, createDefaultConditions);
    expect(res.updates.get('2026-12')!.conditions!.dayMarks).toEqual([{ date: '2026-12-05', kind: 'unavailable', note: '通院' }]);
    expect(res.updates.get('2027-01')!.conditions!.dayMarks).toEqual([{ date: '2027-01-04', kind: 'unavailable', note: '旅行' }]);
    // 元のデータは変えない
    expect(c.dayMarks[0].kind).toBe('work-request');
  });
});

describe('占いの運気カレンダーの取り込み', () => {
  it('運気の名前を「の日」なしでそろえ、勤務条件に登録する（希望の設定は消さない）', () => {
    const rows = toRows('fortune', result([entry({ status: 'event', title: '開運の日', start: null, end: null }), entry({ date: '2026-12-06', status: 'event', title: '☆', confidence: 'low', problem: '記号の意味が分からない', start: null, end: null }), entry({ date: '2026-12-07', status: 'event', title: '', start: null, end: null })]), '1枚目');
    expect(rows.map((r) => [r.action, r.note, r.include])).toEqual([
      ['fortune', '開運', true],
      ['fortune', '☆', true],
      ['fortune', '', false],
    ]);
    expect(rows[1].warning).toContain('記号の意味が分からない');
    expect(rows[2].warning).toContain('運気が読み取れませんでした');
    const c = createDefaultConditions('2026-12');
    c.fortunePrefs = { 開運: 1 };
    c.dayMarks = [{ date: '2026-12-05', kind: 'off-request' }];
    const data = new Map<string, MonthData>([['2026-12', { conditions: c }]]);
    // 同じ日に休み希望があっても、運気は別の登録先なので重ならない
    expect(existingConflict(rows[0], data.get('2026-12'))).toBeNull();
    const res = applyRows(rows, data, createDefaultConditions);
    const next = res.updates.get('2026-12')!.conditions!;
    expect(res.fortunes).toBe(2);
    expect(next.fortunes).toEqual([
      { date: '2026-12-05', label: '開運' },
      { date: '2026-12-06', label: '☆' },
    ]);
    expect(next.fortunePrefs).toEqual({ 開運: 1 });
    expect(next.dayMarks).toEqual(c.dayMarks);
  });

  it('登録済みの運気と違うときは確認する', () => {
    const c = createDefaultConditions('2026-12');
    c.fortunes = [{ date: '2026-12-05', label: '乱気' }];
    const [row] = toRows('fortune', result([entry({ status: 'event', title: '開運', start: null, end: null })]), '1枚目');
    expect(existingConflict(row, { conditions: c })).toBe('登録済みの運気：乱気');
  });
});
