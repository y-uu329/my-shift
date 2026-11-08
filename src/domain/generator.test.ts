import { describe, expect, it } from 'vitest';
import { createDefaultConditions } from './conditions';
import { evaluateDays, generateShifts } from './generator';
import { holidayName, isWeekendOrHoliday } from './holidays';
import type { MonthConditions } from './types';

function base(): MonthConditions {
  const c = createDefaultConditions('2026-12');
  c.monthlyDays = 18;
  c.weeklyDays = 4;
  c.maxConsecutiveDays = 4;
  return c;
}

function maxRun(work: boolean[]) {
  let m = 0;
  let r = 0;
  for (const w of work) {
    r = w ? r + 1 : 0;
    m = Math.max(m, r);
  }
  return m;
}

describe('祝日', () => {
  it('日本の祝日を判定する', () => {
    expect(holidayName('2027-01-01')).toBe('元日');
    expect(holidayName('2026-12-25')).toBeUndefined();
    expect(isWeekendOrHoliday('2027-01-11')).toBe(true); // 成人の日（月）
    expect(isWeekendOrHoliday('2026-12-05')).toBe(true); // 土曜
    expect(isWeekendOrHoliday('2026-12-07')).toBe(false);
  });
});

describe('自動作成', () => {
  it('3パターンを作り、A条件をすべて守る', () => {
    const c = base();
    c.availableWeekdays[0] = false; // 日曜は出勤できない
    c.dayMarks = [
      { date: '2026-12-10', kind: 'unavailable' },
      { date: '2026-12-24', kind: 'off-request' },
      { date: '2026-12-25', kind: 'off-request' },
      { date: '2026-12-15', kind: 'work-request', shiftTypeId: 'late' },
    ];
    const r = generateShifts({ conditions: c });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patterns).toHaveLength(3);
    for (const p of r.patterns) {
      expect(p.hard.every((h) => h.ok)).toBe(true);
      const work = p.days.map((d) => d.work);
      expect(maxRun(work)).toBeLessThanOrEqual(4);
      expect(p.days.find((d) => d.date === '2026-12-10')!.work).toBe(false);
      p.days.filter((d) => d.work).forEach((d) => expect(new Date(d.date + 'T00:00').getDay()).not.toBe(0));
      // 実現可能な条件なので、Bの主要条件は満たせているはず
      const off = p.items.find((i) => i.key === 'offRequest')!;
      expect(off.met).toBe(true);
      const req = p.days.find((d) => d.date === '2026-12-15')!;
      expect(req.work && req.shiftTypeId === 'late').toBe(true);
    }
    const days = r.patterns.find((p) => p.def.id === 'days')!;
    expect(days.stats.workDays).toBe(18);
  });

  it('同じ条件なら毎回同じ結果になる', () => {
    const a = generateShifts({ conditions: base() });
    const b = generateShifts({ conditions: base() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('達成度は実際の数から計算する', () => {
    const c = base();
    c.weeklyDays = null;
    c.dayMarks = [
      { date: '2026-12-01', kind: 'off-request' },
      { date: '2026-12-02', kind: 'off-request' },
    ];
    const days = Array.from({ length: 31 }, (_, i) => ({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, work: i < 3 || (i >= 5 && i < 20 && i % 5 !== 4) }));
    const ev = evaluateDays({ conditions: c }, days);
    const workCount = days.filter((d) => d.work).length;
    const monthly = ev.items.find((i) => i.key === 'monthlyDays')!;
    expect(monthly.rate).toBeCloseTo(1 - Math.abs(workCount - 18) / 18);
    const off = ev.items.find((i) => i.key === 'offRequest')!;
    expect(off.rate).toBe(0); // 2日とも出勤
    expect(off.misses).toHaveLength(2);
  });

  it('出勤できる日が足りないときは理由を表示する', () => {
    const c = base();
    c.weeklyDays = null;
    c.monthlyDays = 25;
    c.availableWeekdays = [false, true, true, true, true, true, false]; // 平日のみ23日
    const r = generateShifts({ conditions: c });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.patterns[1].items.find((i) => i.key === 'monthlyDays')!;
    expect(item.met).toBe(false);
    expect(item.reason).toContain('最大');
  });

  it('休み希望を守ると日数が足りないとき、パターンによって結果が変わる', () => {
    const c = base();
    c.weeklyDays = null;
    c.monthlyDays = 22;
    c.maxConsecutiveDays = 6;
    c.dayMarks = ['03', '04', '08', '09', '11', '12', '16', '17', '18'].map((d) => ({ date: `2026-12-${d}`, kind: 'off-request' as const }));
    const r = generateShifts({ conditions: c });
    if (!r.ok) throw new Error('should be ok');
    const rest = r.patterns.find((p) => p.def.id === 'rest')!;
    const days = r.patterns.find((p) => p.def.id === 'days')!;
    expect(rest.items.find((i) => i.key === 'offRequest')!.met).toBe(true);
    expect(days.stats.workDays).toBe(22);
    expect(days.items.find((i) => i.key === 'offRequest')!.reason).toContain('休み希望をすべて守ると');
  });

  it('A条件どうしが矛盾するときは作成しない', () => {
    const c = base();
    c.workStart = '09:00';
    c.workEnd = '12:00'; // 早番・遅番どちらも入らない
    const r = generateShifts({ conditions: c });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join()).toContain('勤務区分がすべて');
  });

  it('確定済みの予定と前月の連勤を守る', () => {
    const c = base();
    const r = generateShifts({
      conditions: c,
      prevStreak: 4,
      fixed: [{ date: '2026-12-20', work: true, start: '10:00', end: '15:00', source: 'テスト' }],
    });
    if (!r.ok) throw new Error('should be ok');
    for (const p of r.patterns) {
      expect(p.days[0].work).toBe(false); // 前月末4連勤なので12/1は休み
      expect(p.days[19]).toMatchObject({ work: true, start: '10:00', end: '15:00' });
    }
  });

  it('確定済みの勤務が連勤上限を超えるときは作成しない', () => {
    const c = base();
    c.maxConsecutiveDays = 2;
    const fixed = ['01', '02', '03'].map((d) => ({ date: `2026-12-${d}`, work: true, source: 'テスト' }));
    const r = generateShifts({ conditions: c, fixed });
    expect(r.ok).toBe(false);
  });

  it('連休の希望を反映する', () => {
    const c = base();
    c.consecutiveOff = { enabled: true, length: 3, times: 2 };
    const r = generateShifts({ conditions: c });
    if (!r.ok) throw new Error('should be ok');
    const rest = r.patterns.find((p) => p.def.id === 'rest')!;
    expect(rest.items.find((i) => i.key === 'consecutiveOff')!.met).toBe(true);
  });
});

describe('作り直し（今のシフトを活かす）', () => {
  function adopted() {
    const c = base();
    const r = generateShifts({ conditions: c });
    if (!r.ok) throw new Error('should be ok');
    return { c, days: r.patterns.find((p) => p.def.id === 'balance')!.days };
  }

  it('休み希望を1日追加すると、変わる日は少なく、希望は反映される', () => {
    const { c, days } = adopted();
    const target = days.find((d) => d.work && d.date > '2026-12-10')!;
    c.dayMarks = [...c.dayMarks, { date: target.date, kind: 'off-request' }];
    const r = generateShifts({ conditions: c, baseline: days });
    if (!r.ok) throw new Error('should be ok');
    for (const p of r.patterns) {
      expect(p.days.find((d) => d.date === target.date)!.work).toBe(false);
      expect(p.changes!.length).toBeLessThanOrEqual(4);
      expect(p.changes).toContain(target.date);
    }
  });

  it('🔒確定の日は、条件が変わっても変えない', () => {
    const { c, days } = adopted();
    const target = days.find((d) => d.work)!;
    const locked = days.map((d) => (d.date === target.date ? { ...d, locked: true } : d));
    c.dayMarks = [...c.dayMarks, { date: target.date, kind: 'off-request' }];
    const r = generateShifts({ conditions: c, baseline: locked });
    if (!r.ok) throw new Error('should be ok');
    for (const p of r.patterns) {
      const d = p.days.find((x) => x.date === target.date)!;
      expect(d).toMatchObject({ work: true, locked: true, start: target.start, end: target.end });
    }
  });

  it('🔒確定の出勤日を勤務できない日にすると、作成しない', () => {
    const { c, days } = adopted();
    const target = days.find((d) => d.work)!;
    const locked = days.map((d) => (d.date === target.date ? { ...d, locked: true } : d));
    c.dayMarks = [...c.dayMarks, { date: target.date, kind: 'unavailable' }];
    const r = generateShifts({ conditions: c, baseline: locked });
    expect(r.ok).toBe(false);
  });

  it('連勤上限を下げると、それに合わせて直す', () => {
    const { c, days } = adopted();
    c.maxConsecutiveDays = 2;
    const r = generateShifts({ conditions: c, baseline: days });
    if (!r.ok) throw new Error('should be ok');
    for (const p of r.patterns) expect(maxRun(p.days.map((d) => d.work))).toBeLessThanOrEqual(2);
  });

  it('1日の希望勤務時間を変えると、勤務区分が切り替わる', () => {
    const { c, days } = adopted();
    c.shiftTypes = [...c.shiftTypes, { id: 'short', name: '短時間', start: '10:00', end: '15:00', color: '#10b981' }];
    c.preferredHoursPerDay = 5;
    const r = generateShifts({ conditions: c, baseline: days });
    if (!r.ok) throw new Error('should be ok');
    const p = r.patterns[0];
    expect(p.days.filter((d) => d.work).every((d) => d.shiftTypeId === 'short')).toBe(true);
    // 出勤日そのものはほぼ変わらない
    expect(p.days.filter((d, i) => d.work !== days[i].work).length).toBeLessThanOrEqual(2);
  });
});

describe('占いの運気（B）', () => {
  it('「休みたい」運気の日は休み、「出勤したい」運気の日は出勤になりやすい', () => {
    const c = base();
    c.weeklyDays = null;
    c.monthlyDays = 15;
    c.fortunes = [
      { date: '2026-12-02', label: '乱気' },
      { date: '2026-12-09', label: '乱気' },
      { date: '2026-12-16', label: '乱気' },
      { date: '2026-12-03', label: '開運' },
      { date: '2026-12-10', label: '開運' },
      { date: '2026-12-17', label: '開運' },
      { date: '2026-12-04', label: '準備' },
    ];
    c.fortunePrefs = { 乱気: -1, 開運: 1, 準備: 0 };
    const r = generateShifts({ conditions: c });
    if (!r.ok) throw new Error('should be ok');
    for (const p of r.patterns) {
      const item = p.items.find((i) => i.key === 'fortune')!;
      expect(item.priority).toBe('B');
      expect(item.actualText).toBe('6日中6日が希望どおり'); // 「どちらでも」の準備は数えない
      for (const d of ['02', '09', '16']) expect(p.days.find((x) => x.date === `2026-12-${d}`)!.work).toBe(false);
      for (const d of ['03', '10', '17']) expect(p.days.find((x) => x.date === `2026-12-${d}`)!.work).toBe(true);
    }
  });

  it('休み希望（B・より重い）は運気より優先される', () => {
    const c = base();
    c.fortunes = [{ date: '2026-12-03', label: '開運' }];
    c.fortunePrefs = { 開運: 1 };
    c.dayMarks = [{ date: '2026-12-03', kind: 'off-request' }];
    const r = generateShifts({ conditions: c });
    if (!r.ok) throw new Error('should be ok');
    for (const p of r.patterns) expect(p.days.find((x) => x.date === '2026-12-03')!.work).toBe(false);
  });

  it('希望を設定していなければ、達成度の項目に出ない', () => {
    const c = base();
    c.fortunes = [{ date: '2026-12-03', label: '開運' }];
    const r = generateShifts({ conditions: c });
    if (!r.ok) throw new Error('should be ok');
    expect(r.patterns[0].items.some((i) => i.key === 'fortune')).toBe(false);
  });
});

describe('全体の確認：いろいろな月で作れる', () => {
  it('2027年の12か月＋うるう年の2028年2月で、A条件を守って3パターン作れる', async () => {
    const { createSampleConditions } = await import('./conditions');
    const months = [...Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`), '2028-02'];
    for (const m of months) {
      const c = createSampleConditions(m);
      const r = generateShifts({ conditions: c, prevStreak: 2 });
      expect(r.ok, m).toBe(true);
      if (!r.ok) continue;
      expect(r.patterns[0].days).toHaveLength(m === '2028-02' ? 29 : new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate());
      for (const p of r.patterns) {
        expect(p.hard.every((h) => h.ok), `${m} ${p.def.name}`).toBe(true);
        // 前月末の2連勤を含めても、連勤上限（4日）を超えない
        let run = 2;
        let max = 0;
        for (const d of p.days) {
          run = d.work ? run + 1 : 0;
          max = Math.max(max, run);
        }
        expect(max, `${m} ${p.def.name}`).toBeLessThanOrEqual(c.maxConsecutiveDays);
      }
    }
  }, 60_000);
});
