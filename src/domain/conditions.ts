// 勤務条件の「初期値づくり」「前月コピー」「入力チェック」
import { datesOfMonth, daysInMonth, durationHours, isInMonth, timeToMinutes, weekdayOf } from './date';
import type { ConditionKey, DayMark, DayMarkKind, MonthConditions, Priority, ShiftType, YearMonth } from './types';

/** 条件ごとの優先度（ご要望の A / B / C 分類） */
export const CONDITION_PRIORITY: Record<ConditionKey, Priority> = {
  unavailable: 'A',
  fixedSchedule: 'A',
  maxConsecutiveDays: 'A',
  workHours: 'A',
  availableWeekdays: 'A',
  monthlyDays: 'B',
  weeklyDays: 'B',
  offRequest: 'B',
  workRequest: 'B',
  fortune: 'B',
  consecutiveOff: 'B',
  weekendHolidayDays: 'C',
  weekdayPriorities: 'C',
  preferredHours: 'C',
  hoursBalance: 'C',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  A: '絶対に守る',
  B: 'できるだけ守る',
  C: '可能なら反映',
};

export const DAY_MARK_LABEL: Record<DayMarkKind, string> = {
  'off-request': '休み希望',
  unavailable: '勤務できない',
  'work-request': '勤務希望',
};

export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  { id: 'early', name: '早番', start: '09:00', end: '17:00', color: '#f59e0b' },
  { id: 'late', name: '遅番', start: '13:00', end: '21:00', color: '#6366f1' },
];

export function createDefaultConditions(month: YearMonth): MonthConditions {
  return {
    version: 1,
    month,
    monthlyDays: null,
    weeklyDays: null,
    availableWeekdays: [true, true, true, true, true, true, true],
    weekdayPriorities: [1, 1, 1, 1, 1, 1, 1],
    workStart: '09:00',
    workEnd: '21:00',
    shiftTypes: DEFAULT_SHIFT_TYPES.map((s) => ({ ...s })),
    preferredHoursPerDay: null,
    maxConsecutiveDays: 5,
    consecutiveOff: { enabled: false, length: 2, times: 1 },
    weekendHolidayDays: null,
    dayMarks: [],
    memo: '',
    updatedAt: new Date().toISOString(),
  };
}

/** 運気の名前をそろえる（空白と末尾の「の日」を取る） 例：「開運の日」→「開運」 */
export function normalizeFortuneLabel(label: string): string {
  return label.replace(/\s+/g, '').replace(/の日$/, '');
}

/** その月の運気の名前の一覧（希望の設定に使う。希望を設定済みの名前も含める） */
export function fortuneLabels(c: MonthConditions): { label: string; days: number }[] {
  const counts = new Map<string, number>();
  for (const f of c.fortunes ?? []) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);
  for (const k of Object.keys(c.fortunePrefs ?? {})) if (!counts.has(k)) counts.set(k, 0);
  return [...counts].map(([label, days]) => ({ label, days })).sort((a, b) => b.days - a.days || a.label.localeCompare(b.label, 'ja'));
}

/** 使い方を試すためのサンプル条件（メモに「サンプル」と明記） */
export function createSampleConditions(month: YearMonth): MonthConditions {
  const c = createDefaultConditions(month);
  c.monthlyDays = 18;
  c.weeklyDays = 4;
  c.maxConsecutiveDays = 4;
  c.availableWeekdays = [false, true, true, true, true, true, true]; // 日曜は出勤できない
  c.weekdayPriorities = [1, 1, 1, 2, 1, 1, 0]; // 水曜はできれば・土曜は避けたい
  c.consecutiveOff = { enabled: true, length: 2, times: 2 };
  c.weekendHolidayDays = 2;
  const d = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
  c.dayMarks = [
    { date: d(8), kind: 'unavailable', note: '通院' },
    { date: d(12), kind: 'off-request' },
    { date: d(13), kind: 'off-request' },
    { date: d(20), kind: 'work-request', shiftTypeId: 'late' },
  ];
  c.memo = 'これはサンプルの条件です。自由に書き換えて試してください。';
  return c;
}

/**
 * 前月の条件を新しい月にコピーする。
 * 「休み希望日」などの日付の指定は月ごとに違うので、コピーしない。
 * （日数・曜日・時間・勤務区分・連勤などの「いつもの設定」だけを引き継ぐ）
 */
export function copyConditionsToMonth(source: MonthConditions, month: YearMonth): MonthConditions {
  const copied: MonthConditions = structuredClone(source);
  copied.month = month;
  copied.dayMarks = [];
  // 運気は月ごとに違うのでコピーしない（運気ごとの希望は引き継ぐ）
  copied.fortunes = [];
  // 月の日数を超える希望日数は、その月の日数までに収める
  if (copied.monthlyDays !== null) {
    copied.monthlyDays = Math.min(copied.monthlyDays, daysInMonth(month));
  }
  copied.updatedAt = new Date().toISOString();
  return copied;
}

/**
 * 日付の指定を切り替える。
 * 同じ日には1種類だけ指定できる（休み希望と勤務希望が同時に付かないようにする）。
 * kind が null なら指定を外す。
 */
export function setDayMark(marks: DayMark[], date: string, kind: DayMarkKind | null): DayMark[] {
  const others = marks.filter((m) => m.date !== date);
  if (kind === null) return others;
  const previous = marks.find((m) => m.date === date);
  const next: DayMark = { date, kind };
  if (previous?.note) next.note = previous.note;
  if (kind === 'work-request' && previous?.shiftTypeId) next.shiftTypeId = previous.shiftTypeId;
  return [...others, next].sort((a, b) => a.date.localeCompare(b.date));
}

export interface ValidationIssue {
  /** error: 保存できない / warning: 保存はできるが注意 */
  level: 'error' | 'warning';
  field: string;
  message: string;
}

/** 入力内容のチェック */
export function validateConditions(c: MonthConditions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const total = daysInMonth(c.month);
  const err = (field: string, message: string) => issues.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ level: 'warning', field, message });
  const isInt = (n: number) => Number.isInteger(n);

  if (c.monthlyDays !== null && (!isInt(c.monthlyDays) || c.monthlyDays < 0 || c.monthlyDays > total)) {
    err('monthlyDays', `月の希望出勤日数は 0〜${total} の整数で入力してください`);
  }
  if (c.weeklyDays !== null && (!isInt(c.weeklyDays) || c.weeklyDays < 0 || c.weeklyDays > 7)) {
    err('weeklyDays', '週の希望出勤日数は 0〜7 の整数で入力してください');
  }
  if (!isInt(c.maxConsecutiveDays) || c.maxConsecutiveDays < 1 || c.maxConsecutiveDays > 31) {
    err('maxConsecutiveDays', '連勤の最大日数は 1〜31 の整数で入力してください');
  }
  if (c.preferredHoursPerDay !== null && (c.preferredHoursPerDay <= 0 || c.preferredHoursPerDay > 24)) {
    err('preferredHoursPerDay', '1日の希望勤務時間は 0より大きく24以下で入力してください');
  }
  if (c.weekendHolidayDays !== null && (!isInt(c.weekendHolidayDays) || c.weekendHolidayDays < 0 || c.weekendHolidayDays > total)) {
    err('weekendHolidayDays', '土日祝の希望出勤回数は 0以上の整数で入力してください');
  }
  if (c.consecutiveOff.enabled) {
    if (!isInt(c.consecutiveOff.length) || c.consecutiveOff.length < 2 || c.consecutiveOff.length > 14) {
      err('consecutiveOff', '連休の日数は 2〜14 の整数で入力してください');
    }
    if (!isInt(c.consecutiveOff.times) || c.consecutiveOff.times < 1 || c.consecutiveOff.times > 10) {
      err('consecutiveOff', '連休の回数は 1〜10 の整数で入力してください');
    }
  }

  if (timeToMinutes(c.workStart) === timeToMinutes(c.workEnd)) {
    err('workHours', '勤務開始時間と終了時間が同じです');
  }

  // 勤務区分のチェック
  c.shiftTypes.forEach((s) => {
    if (!s.name.trim()) err('shiftTypes', '名前が空の勤務区分があります');
    if (s.start === s.end) err('shiftTypes', `「${s.name || '名前なし'}」の開始と終了が同じです`);
    else if (!fitsWithin(s.start, s.end, c.workStart, c.workEnd)) {
      warn('shiftTypes', `「${s.name}」(${s.start}〜${s.end}) が勤務できる時間帯 (${c.workStart}〜${c.workEnd}) からはみ出しています。自動作成ではこの区分を使いません`);
    }
  });
  if (c.shiftTypes.length === 0) warn('shiftTypes', '勤務区分が1つもありません。勤務できる時間帯を1日の勤務として扱います');

  // 日付の指定
  const outside = c.dayMarks.filter((m) => !isInMonth(m.date, c.month));
  if (outside.length > 0) err('dayMarks', `${c.month} 以外の日付が ${outside.length} 件含まれています`);

  // 実現できるかのかんたんな見通し
  if (c.monthlyDays !== null) {
    const workable = countWorkableDays(c);
    if (c.monthlyDays > workable) {
      warn('monthlyDays', `勤務できない日・出勤できない曜日を除くと、出勤できるのは最大 ${workable} 日です（希望 ${c.monthlyDays} 日）`);
    }
  }
  if (c.weeklyDays !== null && c.maxConsecutiveDays < 7) {
    // 連勤上限 k 日を守ると、7日間で働けるのは最大 7 - floor(7 / (k + 1)) 日
    const k = c.maxConsecutiveDays;
    const maxPerWeek = 7 - Math.floor(7 / (k + 1));
    if (c.weeklyDays > maxPerWeek) {
      warn('weeklyDays', `連勤の上限が ${k} 日だと、1週間で働けるのは最大 ${maxPerWeek} 日です（希望 週${c.weeklyDays}日）`);
    }
  }
  const allowedWeekdays = c.availableWeekdays.filter(Boolean).length;
  if (allowedWeekdays === 0) warn('availableWeekdays', '出勤可能な曜日が1つも選ばれていません');
  if (c.weeklyDays !== null && c.weeklyDays > allowedWeekdays) {
    warn('weeklyDays', `出勤可能な曜日は ${allowedWeekdays} 曜日なので、週 ${c.weeklyDays} 日は実現できません`);
  }
  return issues;
}

/** 勤務できない日・出勤できない曜日を除いた、出勤できる日数 */
export function countWorkableDays(c: MonthConditions): number {
  const unavailable = new Set(c.dayMarks.filter((m) => m.kind === 'unavailable').map((m) => m.date));
  return datesOfMonth(c.month).filter((date) => c.availableWeekdays[weekdayOf(date)] && !unavailable.has(date)).length;
}

/** 勤務区分が勤務できる時間帯に収まっているか（日付またぎにも対応） */
export function fitsWithin(start: string, end: string, rangeStart: string, rangeEnd: string): boolean {
  const toRange = (s: string, e: string): [number, number] => {
    const a = timeToMinutes(s);
    let b = timeToMinutes(e);
    if (b <= a) b += 24 * 60;
    return [a, b];
  };
  const [rs, re] = toRange(rangeStart, rangeEnd);
  const [ss, se] = toRange(start, end);
  // 範囲が日付をまたぐ場合、勤務区分を翌日側にずらした場合も考える
  return (ss >= rs && se <= re) || (ss + 1440 >= rs && se + 1440 <= re);
}

export function shiftHours(s: ShiftType): number {
  return durationHours(s.start, s.end);
}

export function newShiftTypeId(): string {
  return `shift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
