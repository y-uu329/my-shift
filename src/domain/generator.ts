// =============================================
// シフト自動作成のしくみ
//
// 1. A（絶対条件）で「休みに固定する日」「出勤に固定する日」を決める
// 2. 残りの日を「出勤 / 休み」のどちらにするか、B・C 条件の点数（ペナルティ）が
//    いちばん小さくなる組み合わせを探す（焼きなまし法という探索方法）
// 3. 結果の達成度は、実際の条件と照らし合わせて数えた数字だけで計算する
// =============================================
import { CONDITION_PRIORITY, fitsWithin, validateConditions } from './conditions';
import { datesOfMonth, durationHours, formatDate, weekdayOf, weeksOfMonth, WEEKDAY_LABELS } from './date';
import { isWeekendOrHoliday } from './holidays';
import type { DateStr, DayAssignment, DayMark, FixedDay, MonthConditions, ShiftType } from './types';

/** 点数をつける条件（B・C） */
export type SoftKey =
  | 'monthlyDays'
  | 'weeklyDays'
  | 'offRequest'
  | 'workRequest'
  | 'fortune'
  | 'consecutiveOff'
  | 'weekendHolidayDays'
  | 'weekdayPriorities'
  | 'preferredHours'
  | 'hoursBalance';

const SOFT_LABEL: Record<SoftKey, string> = {
  monthlyDays: '月の出勤日数',
  weeklyDays: '週の出勤日数',
  offRequest: '休み希望',
  workRequest: '勤務希望日',
  fortune: '占いの運気',
  consecutiveOff: '連休',
  weekendHolidayDays: '土日祝の出勤回数',
  weekdayPriorities: '曜日の優先度',
  preferredHours: '1日の勤務時間',
  hoursBalance: '週ごとの勤務時間のバランス',
};

/** 3つのパターンの考え方（数字が大きい条件ほど優先。「1日ずれる・1回守れない」ごとの重さ） */
export interface PatternDef {
  id: string;
  name: string;
  description: string;
  weights: Record<SoftKey, number>;
}

export const PATTERNS: PatternDef[] = [
  {
    id: 'rest',
    name: '希望休重視',
    description: '休み希望と連休を最優先。出勤日数は少し前後することがあります',
    weights: { offRequest: 10, workRequest: 8, consecutiveOff: 6, fortune: 4, monthlyDays: 3, weeklyDays: 2, weekendHolidayDays: 1, weekdayPriorities: 0.6, preferredHours: 0.5, hoursBalance: 0.5 },
  },
  {
    id: 'days',
    name: '出勤日数重視',
    description: '月・週の希望出勤日数にぴったり合わせることを最優先',
    weights: { monthlyDays: 10, weeklyDays: 6, workRequest: 8, offRequest: 3, fortune: 2, consecutiveOff: 2, weekendHolidayDays: 1, weekdayPriorities: 0.6, preferredHours: 0.5, hoursBalance: 0.5 },
  },
  {
    id: 'balance',
    name: 'バランス重視',
    description: 'すべての希望をバランスよく。週ごとの偏りも少なくします',
    weights: { monthlyDays: 5, weeklyDays: 5, offRequest: 5, workRequest: 6, fortune: 4, consecutiveOff: 4, weekendHolidayDays: 1.5, weekdayPriorities: 1, preferredHours: 1, hoursBalance: 1.5 },
  },
];

// ---------- 結果の形 ----------

export interface Miss {
  date?: DateStr;
  text: string;
}

/** 1つの条件（B・C）の達成状況 */
export interface ItemResult {
  key: SoftKey;
  label: string;
  priority: 'B' | 'C';
  targetText: string;
  actualText: string;
  /** 達成度 0〜1（計算方法は rateNote） */
  rate: number;
  rateNote: string;
  met: boolean;
  misses: Miss[];
  reason?: string;
  /** 探索用のペナルティ（「何日ずれたか」などの量） */
  loss: number;
}

/** A（絶対条件）のチェック結果 */
export interface HardCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ShiftStats {
  workDays: number;
  offDays: number;
  totalHours: number;
  weekendHolidayWork: number;
  maxStreak: number;
  byWeekday: number[];
  weeks: { label: string; days: number; hours: number }[];
  byShiftType: { name: string; color: string; count: number }[];
}

export interface PatternResult {
  def: PatternDef;
  days: DayAssignment[];
  hard: HardCheck[];
  items: ItemResult[];
  stats: ShiftStats;
  summary: { overall: number; b: number | null; c: number | null; met: number; total: number };
  /** 別のパターンとまったく同じ結果になったとき、そのパターン名 */
  sameAs?: string;
  /** 作り直しのとき、今のシフトから変わった日 */
  changes?: DateStr[];
}

export type GenerateResult = { ok: true; patterns: PatternResult[]; notices: string[] } | { ok: false; reasons: string[] };

export interface GenerateInput {
  conditions: MonthConditions;
  /** 確定済みの予定（A） */
  fixed?: FixedDay[];
  /** 前月末に何日連続で出勤しているか（連勤上限の判定に使う） */
  prevStreak?: number;
  /**
   * 作り直しのもとにする今のシフト。指定すると「変える日がなるべく少なくなる」ように探す。
   * 🔒（locked）の日は確定済みの予定として扱い、変えない。
   */
  baseline?: DayAssignment[];
}

/** 今のシフトから1日変えるごとのペナルティ（B条件より軽く、C条件よりやや重い） */
const CHANGE_WEIGHT = 1.2;
export const LOCK_SOURCE = 'カレンダーで確定した日';

// ---------- 準備（前計算） ----------

interface Ctx {
  c: MonthConditions;
  dates: DateStr[];
  n: number;
  wd: number[];
  weekendHol: boolean[];
  /** A 条件で固定された日（null は自由に決めてよい日） */
  lock: ('off' | 'work' | null)[];
  lockReason: (string | null)[];
  fixed: (FixedDay | null)[];
  offReq: boolean[];
  workReq: (DayMark | null)[];
  weeks: number[][];
  offIdx: number[];
  reqIdx: number[];
  /** 日ごとの運気と、その運気への希望（1=出勤したい -1=休みたい） */
  fortune: ({ label: string; pref: number } | null)[];
  allowedTypes: ShiftType[];
  /** 勤務区分が1つもないときに使う勤務時間 */
  fallbackShift: { start: string; end: string } | null;
  prevStreak: number;
  k: number;
  /** 作り直しのもとにするシフト（日付の順） */
  baseline: (DayAssignment | null)[] | null;
}

function buildCtx(input: GenerateInput): Ctx {
  const c = input.conditions;
  const dates = datesOfMonth(c.month);
  const index = new Map(dates.map((d, i) => [d, i]));
  const n = dates.length;
  const wd = dates.map(weekdayOf);
  const lock: Ctx['lock'] = Array(n).fill(null);
  const lockReason: Ctx['lockReason'] = Array(n).fill(null);
  const fixed: Ctx['fixed'] = Array(n).fill(null);
  const offReq = Array(n).fill(false);
  const workReq: Ctx['workReq'] = Array(n).fill(null);

  dates.forEach((_, i) => {
    if (!c.availableWeekdays[wd[i]]) {
      lock[i] = 'off';
      lockReason[i] = `${WEEKDAY_LABELS[wd[i]]}曜日は出勤できない曜日です`;
    }
  });
  for (const m of c.dayMarks) {
    const i = index.get(m.date);
    if (i === undefined) continue;
    if (m.kind === 'unavailable') {
      lock[i] = 'off';
      lockReason[i] = '勤務できない日に指定されています';
    } else if (m.kind === 'off-request') offReq[i] = true;
    else workReq[i] = m;
  }
  const baselineFixed: FixedDay[] = (input.baseline ?? [])
    .filter((d) => d.locked)
    .map((d) => ({ date: d.date, work: d.work, start: d.start, end: d.end, shiftTypeId: d.shiftTypeId, source: LOCK_SOURCE }));
  for (const f of [...(input.fixed ?? []), ...baselineFixed]) {
    const i = index.get(f.date);
    if (i === undefined) continue;
    fixed[i] = f;
    if (lock[i] !== 'off' || !f.work) {
      lock[i] = f.work ? 'work' : 'off';
      lockReason[i] = `確定済みの予定（${f.source}）です`;
    }
  }

  const allowedTypes = c.shiftTypes.filter((s) => s.start !== s.end && fitsWithin(s.start, s.end, c.workStart, c.workEnd));
  return {
    c,
    dates,
    n,
    wd,
    weekendHol: dates.map(isWeekendOrHoliday),
    lock,
    lockReason,
    fixed,
    offReq,
    workReq,
    weeks: weeksOfMonth(c.month).map((w) => w.map((d) => index.get(d)!)),
    fortune: (() => {
      const byDate = new Map((c.fortunes ?? []).map((f) => [f.date, f.label]));
      return dates.map((d) => {
        const label = byDate.get(d);
        return label ? { label, pref: c.fortunePrefs?.[label] ?? 0 } : null;
      });
    })(),
    offIdx: offReq.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
    reqIdx: workReq.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
    allowedTypes,
    fallbackShift: c.shiftTypes.length === 0 ? { start: c.workStart, end: c.workEnd } : null,
    prevStreak: Math.max(0, input.prevStreak ?? 0),
    baseline: input.baseline ? (() => {
      const byDate = new Map(input.baseline!.map((d) => [d.date, d]));
      return dates.map((d) => byDate.get(d) ?? null);
    })() : null,
    k: c.maxConsecutiveDays,
  };
}

// ---------- 勤務区分の割り当て ----------

/** 出勤日に勤務区分（時間）を割り当てる */
function assignShifts(ctx: Ctx, work: boolean[]): DayAssignment[] {
  const pref = ctx.c.preferredHoursPerDay;
  const types = ctx.allowedTypes;
  let closest: ShiftType | undefined;
  if (pref !== null && types.length > 0) {
    closest = types.reduce((best, s) => (Math.abs(durationHours(s.start, s.end) - pref) < Math.abs(durationHours(best.start, best.end) - pref) ? s : best));
  }
  let rotation = 0;
  return ctx.dates.map((date, i) => {
    if (!work[i]) return { date, work: false };
    const f = ctx.fixed[i];
    if (f?.work && f.start && f.end) return { date, work: true, start: f.start, end: f.end, shiftTypeId: f.shiftTypeId };
    const wanted = ctx.workReq[i]?.shiftTypeId;
    let type = wanted ? types.find((s) => s.id === wanted) : undefined;
    // 作り直しのときは、今の勤務区分・時間が条件に合っていればそのまま使う
    const base = ctx.baseline?.[i];
    if (!type && base?.work) {
      const sameHours = (start: string, end: string) => !closest || Math.abs(durationHours(start, end) - durationHours(closest.start, closest.end)) < 0.01;
      const kept = base.shiftTypeId ? types.find((s) => s.id === base.shiftTypeId) : undefined;
      if (kept && sameHours(kept.start, kept.end)) type = kept;
      else if (!base.shiftTypeId && base.start && base.end && fitsWithin(base.start, base.end, ctx.c.workStart, ctx.c.workEnd) && sameHours(base.start, base.end)) {
        return { date, work: true, start: base.start, end: base.end };
      }
    }
    if (!type) {
      if (closest) type = closest;
      else if (types.length > 0) type = types[rotation++ % types.length]; // 区分を順番に回して偏りを防ぐ
    }
    if (type) return { date, work: true, shiftTypeId: type.id, start: type.start, end: type.end };
    if (ctx.fallbackShift) return { date, work: true, ...ctx.fallbackShift };
    return { date, work: true };
  });
}

const hoursOf = (d: DayAssignment) => (d.work && d.start && d.end ? durationHours(d.start, d.end) : 0);

/** 連続で出勤している日のかたまり（[開始, 長さ]）。前月末の連勤も含める */
function workRuns(ctx: Ctx, work: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  let len = 0;
  for (let i = 0; i < ctx.n; i++) {
    if (work[i]) {
      if (len === 0) start = i;
      len++;
    } else if (len > 0) {
      runs.push([start, len]);
      len = 0;
    }
  }
  if (len > 0) runs.push([start, len]);
  // 前月末から続く連勤を最初のかたまりに足す
  if (ctx.prevStreak > 0 && runs.length > 0 && runs[0][0] === 0) runs[0] = [0, runs[0][1] + ctx.prevStreak];
  return runs;
}

function offRuns(ctx: Ctx, work: boolean[]): number[] {
  const runs: number[] = [];
  let len = 0;
  for (let i = 0; i < ctx.n; i++) {
    if (!work[i]) len++;
    else if (len > 0) {
      runs.push(len);
      len = 0;
    }
  }
  if (len > 0) runs.push(len);
  return runs;
}

const weekLabel = (ctx: Ctx, w: number[]) => `${formatDate(ctx.dates[w[0]])}〜${formatDate(ctx.dates[w[w.length - 1]])}`;
/** 月の途中で切れている週は、日数に合わせて目標を減らす */
const weekTarget = (target: number, len: number) => (len === 7 ? target : Math.round((target * len) / 7));
const pct = (r: number) => `${Math.round(r * 100)}%`;
const closeness = (actual: number, target: number) => (target === 0 ? (actual === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(actual - target) / target));

// ---------- 条件ごとの採点 ----------

/** B・C 条件をすべて採点する。detailed=false のときは説明文を作らない（探索中の高速化） */
function measure(ctx: Ctx, work: boolean[], days: DayAssignment[], detailed: boolean): ItemResult[] {
  const c = ctx.c;
  const items: ItemResult[] = [];
  const push = (key: SoftKey, r: Omit<ItemResult, 'key' | 'label' | 'priority'>) =>
    items.push({ key, label: SOFT_LABEL[key], priority: CONDITION_PRIORITY[key] as 'B' | 'C', ...r });
  const workCount = work.filter(Boolean).length;

  if (c.monthlyDays !== null) {
    const t = c.monthlyDays;
    push('monthlyDays', {
      targetText: `${t}日`,
      actualText: `${workCount}日`,
      rate: closeness(workCount, t),
      rateNote: '1 −（ずれた日数 ÷ 目標日数）',
      met: workCount === t,
      misses: detailed && workCount !== t ? [{ text: `目標より${Math.abs(workCount - t)}日${workCount > t ? '多い' : '少ない'}（${workCount}日）` }] : [],
      loss: Math.abs(workCount - t),
    });
  }

  if (c.weeklyDays !== null) {
    let metWeeks = 0;
    let loss = 0;
    const misses: Miss[] = [];
    for (const w of ctx.weeks) {
      const tw = weekTarget(c.weeklyDays, w.length);
      const aw = w.filter((i) => work[i]).length;
      loss += Math.abs(aw - tw);
      if (aw === tw) metWeeks++;
      else if (detailed) misses.push({ date: ctx.dates[w[0]], text: `${weekLabel(ctx, w)}：${aw}日（目標${tw}日${w.length < 7 ? `・${w.length}日間の週` : ''}）` });
    }
    push('weeklyDays', {
      targetText: `週${c.weeklyDays}日`,
      actualText: `${ctx.weeks.length}週中${metWeeks}週が目標どおり`,
      rate: metWeeks / ctx.weeks.length,
      rateNote: '目標どおりの週 ÷ 週の数（月の途中で切れる週は日数に合わせて目標を減らす）',
      met: metWeeks === ctx.weeks.length,
      misses,
      loss,
    });
  }

  const offIdx = ctx.offIdx;
  if (offIdx.length > 0) {
    const missed = offIdx.filter((i) => work[i]);
    push('offRequest', {
      targetText: `${offIdx.length}日`,
      actualText: `${offIdx.length - missed.length}日 休み`,
      rate: (offIdx.length - missed.length) / offIdx.length,
      rateNote: '休みになった希望日 ÷ 休み希望の日数',
      met: missed.length === 0,
      misses: detailed ? missed.map((i) => ({ date: ctx.dates[i], text: `${formatDate(ctx.dates[i])} が出勤になっています` })) : [],
      loss: missed.length,
    });
  }

  const reqIdx = ctx.reqIdx;
  if (reqIdx.length > 0) {
    let ok = 0;
    let loss = 0;
    const misses: Miss[] = [];
    for (const i of reqIdx) {
      const wanted = ctx.workReq[i]!.shiftTypeId;
      if (!work[i]) {
        loss += 1;
        if (detailed) misses.push({ date: ctx.dates[i], text: `${formatDate(ctx.dates[i])} が休みになっています` });
      } else if (wanted && days[i].shiftTypeId !== wanted) {
        loss += 0.5;
        if (detailed) {
          const name = c.shiftTypes.find((s) => s.id === wanted)?.name ?? '指定の区分';
          misses.push({ date: ctx.dates[i], text: `${formatDate(ctx.dates[i])} は出勤ですが「${name}」になっていません` });
        }
      } else ok++;
    }
    push('workRequest', {
      targetText: `${reqIdx.length}日`,
      actualText: `${ok}日 希望どおり`,
      rate: ok / reqIdx.length,
      rateNote: '希望どおり出勤できた日 ÷ 勤務希望の日数',
      met: ok === reqIdx.length,
      misses,
      loss,
    });
  }

  {
    // 占いの運気：「出勤したい」運気の日は出勤、「休みたい」運気の日は休みなら達成
    let units = 0;
    let ok = 0;
    const misses: Miss[] = [];
    for (let i = 0; i < ctx.n; i++) {
      const f = ctx.fortune[i];
      if (!f || f.pref === 0 || ctx.lock[i] !== null) continue;
      units++;
      const good = f.pref > 0 ? work[i] : !work[i];
      if (good) ok++;
      else if (detailed) misses.push({ date: ctx.dates[i], text: `${formatDate(ctx.dates[i])}（${f.label}）が${f.pref > 0 ? '休み' : '出勤'}になっています` });
    }
    if (units > 0) {
      push('fortune', {
        targetText: '出勤したい運気の日は出勤・休みたい運気の日は休み',
        actualText: `${units}日中${ok}日が希望どおり`,
        rate: ok / units,
        rateNote: '希望どおりの日 ÷ 希望を設定した運気の日数（出勤できない日などは数えない）',
        met: ok === units,
        misses,
        loss: units - ok,
      });
    }
  }

  if (c.consecutiveOff.enabled) {
    const { length: L, times } = c.consecutiveOff;
    const got = offRuns(ctx, work).filter((r) => r >= L).length;
    push('consecutiveOff', {
      targetText: `${L}連休以上を${times}回`,
      actualText: `${got}回`,
      rate: Math.min(got, times) / times,
      rateNote: '取れた連休の回数 ÷ 希望回数（上限100%）',
      met: got >= times,
      misses: detailed && got < times ? [{ text: `${L}連休以上が${times - got}回足りません` }] : [],
      loss: Math.max(0, times - got),
    });
  }

  if (c.weekendHolidayDays !== null) {
    const t = c.weekendHolidayDays;
    const a = ctx.dates.filter((_, i) => work[i] && ctx.weekendHol[i]).length;
    push('weekendHolidayDays', {
      targetText: `${t}回`,
      actualText: `${a}回`,
      rate: closeness(a, t),
      rateNote: '1 −（ずれた回数 ÷ 目標回数）',
      met: a === t,
      misses: detailed && a !== t ? [{ text: `土日祝の出勤が目標より${Math.abs(a - t)}回${a > t ? '多い' : '少ない'}（${a}回）` }] : [],
      loss: Math.abs(a - t),
    });
  }

  {
    // 曜日の優先度：「避けたい」曜日は休み、「できれば・ぜひ」の曜日は出勤できていれば達成
    let units = 0;
    let ok = 0;
    let loss = 0;
    const avoidWorked: string[] = [];
    let wantTotal = 0;
    let wantWorked = 0;
    for (let i = 0; i < ctx.n; i++) {
      if (ctx.lock[i] !== null) continue;
      const level = c.weekdayPriorities[ctx.wd[i]];
      if (level === 1) continue;
      units++;
      if (level === 0) {
        if (!work[i]) ok++;
        else {
          loss += 1;
          if (detailed) avoidWorked.push(formatDate(ctx.dates[i]));
        }
      } else {
        wantTotal++;
        if (work[i]) {
          ok++;
          wantWorked++;
        } else loss += level === 3 ? 1 : 0.5;
      }
    }
    if (units > 0) {
      const misses: Miss[] = [];
      if (detailed && avoidWorked.length > 0) misses.push({ text: `「避けたい」曜日に${avoidWorked.length}回出勤（${avoidWorked.join('、')}）` });
      if (detailed && wantTotal > wantWorked) misses.push({ text: `「できれば・ぜひ」の曜日 ${wantTotal}日のうち ${wantTotal - wantWorked}日が休み` });
      push('weekdayPriorities', {
        targetText: '避けたい曜日は休み・できれば/ぜひの曜日は出勤',
        actualText: `${units}日中${ok}日が希望どおり`,
        rate: ok / units,
        rateNote: '希望どおりの日 ÷ 優先度を付けた曜日の日数（「ふつう」は数えない）',
        met: ok === units,
        misses,
        loss,
      });
    }
  }

  const pref = c.preferredHoursPerDay;
  if (pref !== null && workCount > 0) {
    const off = days.filter((d) => d.work && Math.abs(hoursOf(d) - pref) > 0.01);
    push('preferredHours', {
      targetText: `${pref}時間`,
      actualText: `${workCount}日中${workCount - off.length}日が${pref}時間`,
      rate: (workCount - off.length) / workCount,
      rateNote: '希望時間どおりの出勤日 ÷ 出勤日数',
      met: off.length === 0,
      misses: detailed && off.length > 0 ? [{ text: `${off.length}日が${pref}時間ではありません（例：${formatDate(off[0].date)} ${hoursOf(off[0])}時間）` }] : [],
      loss: off.reduce((s, d) => s + Math.abs(hoursOf(d) - pref), 0) / Math.max(pref, 1),
    });
  }

  const fullWeeks = ctx.weeks.filter((w) => w.length === 7);
  if (fullWeeks.length >= 2 && workCount > 0) {
    const hours = fullWeeks.map((w) => w.reduce((s, i) => s + hoursOf(days[i]), 0));
    const max = Math.max(...hours);
    const min = Math.min(...hours);
    const avgShift = days.reduce((s, d) => s + hoursOf(d), 0) / workCount || 8;
    push('hoursBalance', {
      targetText: '週ごとの勤務時間をそろえる',
      actualText: `${min}〜${max}時間（差${max - min}時間）`,
      rate: max === 0 ? 1 : min / max,
      rateNote: '最も少ない週の時間 ÷ 最も多い週の時間（7日そろった週で比較）',
      met: max - min < 0.01,
      misses: detailed && max - min >= 0.01 ? [{ text: `週ごとの勤務時間に${max - min}時間の差があります` }] : [],
      loss: (max - min) / avgShift,
    });
  }
  return items;
}

/** A 条件のチェック */
function checkHard(ctx: Ctx, work: boolean[], days: DayAssignment[]): HardCheck[] {
  const c = ctx.c;
  const checks: HardCheck[] = [];
  const unavailable = c.dayMarks.filter((m) => m.kind === 'unavailable');
  const badUnavailable = unavailable.filter((m) => work[ctx.dates.indexOf(m.date)]);
  checks.push({
    label: '勤務できない日',
    ok: badUnavailable.length === 0,
    detail: unavailable.length === 0 ? '指定なし' : badUnavailable.length === 0 ? `${unavailable.length}日すべて休み` : `${badUnavailable.map((m) => formatDate(m.date)).join('、')} が出勤`,
  });
  const badWeekday = ctx.dates.filter((_, i) => work[i] && !c.availableWeekdays[ctx.wd[i]]);
  checks.push({ label: '出勤できる曜日', ok: badWeekday.length === 0, detail: badWeekday.length === 0 ? '出勤できない曜日の出勤なし' : `${badWeekday.map(formatDate).join('、')} が出勤` });
  const maxRun = Math.max(0, ...workRuns(ctx, work).map((r) => r[1]));
  checks.push({
    label: `連勤の上限（${ctx.k}日）`,
    ok: maxRun <= ctx.k,
    detail: `最大${maxRun}連勤${ctx.prevStreak > 0 ? `（前月末の${ctx.prevStreak}連勤を含む）` : ''}`,
  });
  const outside = days.filter((d) => d.work && d.start && d.end && !fitsWithin(d.start, d.end, c.workStart, c.workEnd) && !ctx.fixed[ctx.dates.indexOf(d.date)]);
  checks.push({ label: `勤務できる時間帯（${c.workStart}〜${c.workEnd}）`, ok: outside.length === 0, detail: outside.length === 0 ? 'すべての勤務が時間帯の中' : `${outside.length}日がはみ出し` });
  const fixedDays = ctx.fixed.filter(Boolean) as FixedDay[];
  if (fixedDays.length > 0) {
    const broken = fixedDays.filter((f) => work[ctx.dates.indexOf(f.date)] !== f.work);
    checks.push({ label: '確定済みの予定', ok: broken.length === 0, detail: broken.length === 0 ? `${fixedDays.length}日すべて反映` : `${broken.length}日が反映されていません` });
  }
  return checks;
}

// ---------- 探索 ----------

/** 同じ条件なら毎回同じ結果になるように、決まった順番の乱数を使う */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalCost(ctx: Ctx, work: boolean[], weights: Record<SoftKey, number>): number {
  const days = assignShifts(ctx, work);
  let cost = 0;
  for (const item of measure(ctx, work, days, false)) cost += weights[item.key] * item.loss;
  // A：連勤の上限を超えた日数に大きなペナルティ
  for (const [, len] of workRuns(ctx, work)) {
    if (len > ctx.k) cost += 1000 * (len - ctx.k);
    // 同じ点数なら、出勤が固まりすぎない並びを選ぶ（ごく小さな調整）
    cost += 0.01 * len * len;
  }
  if (ctx.baseline) {
    for (let i = 0; i < ctx.n; i++) if (work[i] !== !!ctx.baseline[i]?.work) cost += CHANGE_WEIGHT;
  }
  return cost;
}

function initialPlan(ctx: Ctx, rng: () => number, greedy: boolean): boolean[] {
  if (greedy && ctx.baseline) return ctx.lock.map((l, i) => (l === null ? !!ctx.baseline![i]?.work : l === 'work'));
  const work = ctx.lock.map((l) => l === 'work');
  const free = ctx.lock.map((l, i) => (l === null ? i : -1)).filter((i) => i >= 0);
  const c = ctx.c;
  const target = c.monthlyDays ?? (c.weeklyDays !== null ? Math.round((c.weeklyDays * ctx.n) / 7) : Math.round(free.length / 2));
  const desire = (i: number) => (ctx.workReq[i] ? 5 : 0) - (ctx.offReq[i] ? 5 : 0) + 3 * (ctx.fortune[i]?.pref ?? 0) + c.weekdayPriorities[ctx.wd[i]] + (greedy ? 0 : rng() * 4);
  const need = Math.max(0, target - work.filter(Boolean).length);
  [...free].sort((a, b) => desire(b) - desire(a)).slice(0, need).forEach((i) => (work[i] = true));
  return work;
}

function optimize(ctx: Ctx, weights: Record<SoftKey, number>, seed: number): boolean[] {
  const free = ctx.lock.map((l, i) => (l === null ? i : -1)).filter((i) => i >= 0);
  const rng = mulberry32(seed);
  let best = initialPlan(ctx, rng, true);
  let bestCost = totalCost(ctx, best, weights);
  if (free.length === 0) return best;

  const RESTARTS = 3;
  const ITER = 2500;
  for (let r = 0; r < RESTARTS; r++) {
    const cur = r === 0 ? [...best] : initialPlan(ctx, rng, false);
    let curCost = totalCost(ctx, cur, weights);
    for (let it = 0; it < ITER; it++) {
      const temp = 3 * Math.pow(0.001, it / ITER); // 少しずつ「悪くなる変更」を受け入れにくくする
      let undo: () => void;
      if (rng() < 0.5) {
        const i = free[Math.floor(rng() * free.length)];
        cur[i] = !cur[i];
        undo = () => (cur[i] = !cur[i]);
      } else {
        // 出勤の日と休みの日を1日ずつ選んで入れ替える
        const a = free[Math.floor(rng() * free.length)];
        let b = -1;
        for (let t = 0; t < 8 && b < 0; t++) {
          const x = free[Math.floor(rng() * free.length)];
          if (cur[x] !== cur[a]) b = x;
        }
        if (b < 0) continue;
        cur[a] = !cur[a];
        cur[b] = !cur[b];
        undo = () => {
          cur[a] = !cur[a];
          cur[b] = !cur[b];
        };
      }
      const cost = totalCost(ctx, cur, weights);
      if (cost <= curCost || rng() < Math.exp((curCost - cost) / temp)) {
        curCost = cost;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          best = [...cur];
        }
      } else undo();
    }
  }
  return polish(ctx, best, weights, free);
}

/** 最後に「1日だけ変える」「2日を入れ替える」で良くなるところがないか確かめる */
function polish(ctx: Ctx, work: boolean[], weights: Record<SoftKey, number>, free: number[]): boolean[] {
  const cur = [...work];
  let cost = totalCost(ctx, cur, weights);
  for (let round = 0; round < 4; round++) {
    let improved = false;
    for (const i of free) {
      cur[i] = !cur[i];
      const c2 = totalCost(ctx, cur, weights);
      if (c2 < cost - 1e-9) {
        cost = c2;
        improved = true;
      } else cur[i] = !cur[i];
    }
    if (improved) continue; // 1日だけの変更で良くなったなら、もう一度そこから試す
    for (const a of free) {
      for (const b of free) {
        if (!cur[a] || cur[b]) continue;
        cur[a] = false;
        cur[b] = true;
        const c2 = totalCost(ctx, cur, weights);
        if (c2 < cost - 1e-9) {
          cost = c2;
          improved = true;
        } else {
          cur[a] = true;
          cur[b] = false;
        }
      }
    }
    if (!improved) break;
  }
  return cur;
}

// ---------- 理由の説明 ----------

/** A 条件を守ったときに出勤できる最大日数（動的計画法で正確に計算） */
function maxWorkDays(ctx: Ctx, extraOff: boolean[] = []): number {
  const k = ctx.k;
  const NEG = -1e9;
  let dp = Array(k + 1).fill(NEG);
  dp[Math.min(ctx.prevStreak, k)] = 0;
  for (let i = 0; i < ctx.n; i++) {
    const next = Array(k + 1).fill(NEG);
    const canOff = ctx.lock[i] !== 'work';
    const canWork = ctx.lock[i] !== 'off' && !extraOff[i];
    for (let s = 0; s <= k; s++) {
      if (dp[s] === NEG) continue;
      if (canOff) next[0] = Math.max(next[0], dp[s]);
      if (canWork && s + 1 <= k) next[s + 1] = Math.max(next[s + 1], dp[s] + 1);
    }
    dp = next;
  }
  return Math.max(...dp);
}

function explain(ctx: Ctx, items: ItemResult[], work: boolean[], def?: PatternDef) {
  const c = ctx.c;
  const maxA = maxWorkDays(ctx);
  const maxWithOff = maxWorkDays(ctx, ctx.offReq);
  const workCount = work.filter(Boolean).length;
  const FOCUS: Record<string, string> = { rest: '休み希望と連休', days: '月・週の出勤日数', balance: '条件全体のバランス' };
  const higher = (_key: SoftKey) =>
    def ? `このパターン（${def.name}）では、${FOCUS[def.id] ?? 'ほかの条件'}を優先したためです` : 'ほかの条件との兼ね合いで調整しました';
  const weekSum = c.weeklyDays === null ? null : ctx.weeks.reduce((s, w) => s + weekTarget(c.weeklyDays!, w.length), 0);
  for (const item of items) {
    if (item.met) continue;
    switch (item.key) {
      case 'monthlyDays':
        if (workCount < c.monthlyDays! && maxA < c.monthlyDays!) item.reason = `勤務できない日・出勤できない曜日・連勤上限（${ctx.k}日）を守ると、出勤できるのは最大${maxA}日です`;
        else if (workCount < c.monthlyDays! && maxWithOff < c.monthlyDays!) item.reason = `休み希望をすべて守ると、出勤できるのは最大${maxWithOff}日です`;
        else if (weekSum !== null && weekSum !== c.monthlyDays && workCount === weekSum)
          item.reason = `週の希望（週${c.weeklyDays}日）をこの月の週ごとに合計すると${weekSum}日になり、月の希望（${c.monthlyDays}日）と合わないため、週の希望に合わせました`;
        else item.reason = higher('monthlyDays');
        break;
      case 'weeklyDays': {
        const tight = ctx.weeks.filter((w) => w.filter((i) => ctx.lock[i] !== 'off').length < weekTarget(c.weeklyDays!, w.length));
        const sumWeek = weekSum!;
        if (tight.length > 0) item.reason = `${tight.map((w) => weekLabel(ctx, w)).join('、')} は出勤できる日が目標より少ない週です`;
        else if (c.monthlyDays !== null && sumWeek !== c.monthlyDays) item.reason = `月の希望（${c.monthlyDays}日）と、週の希望を合計した日数（${sumWeek}日）が合わないため、両方を同時には満たせません`;
        else item.reason = higher('weeklyDays');
        break;
      }
      case 'offRequest':
        item.reason = c.monthlyDays !== null && maxWithOff < c.monthlyDays ? `休み希望をすべて守ると、月の希望出勤日数（${c.monthlyDays}日）に届かないため` : higher('offRequest');
        break;
      case 'workRequest': {
        const blocked = item.misses.map((m) => ctx.dates.indexOf(m.date!)).filter((i) => i >= 0 && ctx.lockReason[i]);
        const typeless = ctx.workReq.some((m) => m?.shiftTypeId && !ctx.allowedTypes.some((s) => s.id === m.shiftTypeId));
        if (blocked.length > 0) item.reason = blocked.map((i) => `${formatDate(ctx.dates[i])}：${ctx.lockReason[i]}`).join(' / ');
        else if (typeless) item.reason = '希望した勤務区分が、勤務できる時間帯の外にあります';
        else item.reason = higher('workRequest');
        break;
      }
      case 'weekendHolidayDays': {
        const avail = ctx.dates.filter((_, i) => ctx.weekendHol[i] && ctx.lock[i] !== 'off').length;
        item.reason = avail < c.weekendHolidayDays! ? `出勤できる土日祝はこの月に${avail}日しかありません` : higher('weekendHolidayDays');
        break;
      }
      case 'preferredHours':
        item.reason = ctx.allowedTypes.some((s) => Math.abs(durationHours(s.start, s.end) - c.preferredHoursPerDay!) < 0.01)
          ? higher('preferredHours')
          : `${c.preferredHoursPerDay}時間の勤務区分がないため、いちばん近い区分を使いました`;
        break;
      default:
        item.reason = higher(item.key);
    }
  }
}

// ---------- 集計 ----------

export function computeStats(c: MonthConditions, days: DayAssignment[]): ShiftStats {
  const work = days.filter((d) => d.work);
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  work.forEach((d) => byWeekday[weekdayOf(d.date)]++);
  let maxStreak = 0;
  let run = 0;
  for (const d of days) {
    run = d.work ? run + 1 : 0;
    maxStreak = Math.max(maxStreak, run);
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks = weeksOfMonth(c.month).map((w) => {
    const ws = w.map((date) => byDate.get(date)).filter((d): d is DayAssignment => !!d?.work);
    return { label: `${formatDate(w[0])}〜${formatDate(w[w.length - 1])}`, days: ws.length, hours: ws.reduce((s, d) => s + hoursOf(d), 0) };
  });
  const byShiftType = c.shiftTypes
    .map((s) => ({ name: s.name, color: s.color, count: work.filter((d) => d.shiftTypeId === s.id).length }))
    .filter((s) => s.count > 0);
  return {
    workDays: work.length,
    offDays: days.length - work.length,
    totalHours: work.reduce((s, d) => s + hoursOf(d), 0),
    weekendHolidayWork: work.filter((d) => isWeekendOrHoliday(d.date)).length,
    maxStreak,
    byWeekday,
    weeks,
    byShiftType,
  };
}

/** 達成度のまとめ。総合 = B条件の平均を2倍、C条件の平均を1倍で重みづけした平均 */
export function summarize(items: ItemResult[]): PatternResult['summary'] {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const b = avg(items.filter((i) => i.priority === 'B').map((i) => i.rate));
  const c = avg(items.filter((i) => i.priority === 'C').map((i) => i.rate));
  const overall = b === null && c === null ? 1 : b === null ? c! : c === null ? b : (2 * b + c) / 3;
  return { overall, b, c, met: items.filter((i) => i.met).length, total: items.length };
}

/** 作成済みのシフトを、条件と照らし合わせて採点し直す（手動で編集したあとなどに使う） */
export function evaluateDays(input: GenerateInput, days: DayAssignment[]) {
  const ctx = buildCtx(input);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const full = ctx.dates.map((date) => byDate.get(date) ?? { date, work: false });
  const work = full.map((d) => d.work);
  const items = measure(ctx, work, full, true);
  explain(ctx, items, work);
  return { hard: checkHard(ctx, work, full), items, stats: computeStats(ctx.c, full), summary: summarize(items) };
}

// ---------- 入口 ----------

/** 作成前のチェック。A 条件どうしが矛盾していたら、作成せずに理由を返す */
function precheck(ctx: Ctx): string[] {
  const reasons: string[] = [];
  const c = ctx.c;
  for (const e of validateConditions(c).filter((i) => i.level === 'error')) reasons.push(`勤務条件の入力エラー：${e.message}`);
  if (c.shiftTypes.length > 0 && ctx.allowedTypes.length === 0) {
    reasons.push(`勤務区分がすべて「勤務できる時間帯（${c.workStart}〜${c.workEnd}）」の外にあるため、出勤日を作れません。時間帯か勤務区分を見直してください`);
  }
  ctx.fixed.forEach((f, i) => {
    if (!f?.work) return;
    if (!c.availableWeekdays[ctx.wd[i]]) reasons.push(`${formatDate(ctx.dates[i])} は確定済みの勤務ですが、出勤できない曜日になっています`);
    if (c.dayMarks.some((m) => m.date === f.date && m.kind === 'unavailable')) reasons.push(`${formatDate(ctx.dates[i])} は確定済みの勤務ですが、勤務できない日に指定されています`);
  });
  const forced = ctx.lock.map((l) => l === 'work');
  const longest = Math.max(0, ...workRuns(ctx, forced).map((r) => r[1]));
  if (longest > ctx.k) reasons.push(`確定済みの勤務だけで${longest}連勤になり、連勤の上限（${ctx.k}日）を超えています`);
  return reasons;
}

export function generateShifts(input: GenerateInput): GenerateResult {
  const ctx = buildCtx(input);
  const reasons = precheck(ctx);
  if (reasons.length > 0) return { ok: false, reasons };

  const c = ctx.c;
  const notices: string[] = [];
  if (c.monthlyDays === null && c.weeklyDays === null) notices.push('出勤日数の希望が未設定のため、勤務希望日と曜日の優先度をもとに出勤日を決めています');
  const skipped = c.shiftTypes.filter((s) => !ctx.allowedTypes.includes(s));
  if (skipped.length > 0) notices.push(`${skipped.map((s) => `「${s.name}」`).join('')}は勤務できる時間帯の外にあるため使っていません`);
  if (ctx.prevStreak > 0) notices.push(`前月末の${ctx.prevStreak}連勤を引き継いで、連勤の上限を判定しています`);
  const lockedDates = new Set((input.baseline ?? []).filter((d) => d.locked).map((d) => d.date));
  if (ctx.baseline) {
    notices.push(`今のシフトをもとに、変える日がなるべく少なくなるように作り直しています${lockedDates.size > 0 ? `（🔒確定の${lockedDates.size}日は変えていません）` : ''}`);
  }

  const patterns: PatternResult[] = [];
  PATTERNS.forEach((def, p) => {
    const work = optimize(ctx, def.weights, 20240 + p * 7919);
    const days = assignShifts(ctx, work).map((d) => (lockedDates.has(d.date) ? { ...d, locked: true } : d));
    const items = measure(ctx, work, days, true);
    explain(ctx, items, work, def);
    const same = patterns.find((q) => q.days.every((d, i) => d.work === days[i].work && d.shiftTypeId === days[i].shiftTypeId));
    const changes = ctx.baseline ? diffDays(ctx.baseline, days) : undefined;
    patterns.push({ def, days, hard: checkHard(ctx, work, days), items, stats: computeStats(c, days), summary: summarize(items), sameAs: same?.def.name, changes });
  });

  // 念のため：A 条件が守れていない結果は出さない
  const broken = patterns.flatMap((p) => p.hard.filter((h) => !h.ok).map((h) => `${p.def.name}：${h.label}（${h.detail}）`));
  if (broken.length > 0) return { ok: false, reasons: ['絶対条件（A）を守れるシフトが見つかりませんでした', ...broken] };
  return { ok: true, patterns, notices };
}

/** 出勤／休み、または勤務時間が変わった日 */
export function diffDays(before: (DayAssignment | null)[], after: DayAssignment[]): DateStr[] {
  return after
    .filter((d, i) => {
      const b = before[i];
      if (!b) return d.work;
      if (b.work !== d.work) return true;
      return d.work && (b.start !== d.start || b.end !== d.end);
    })
    .map((d) => d.date);
}

export { pct as formatPercent };
