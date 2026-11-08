// 写真から読み取った内容を「確認用の一覧」にし、重複を調べ、登録するところまで（画面やAPIに頼らない部分）
import { normalizeFortuneLabel, setDayMark } from './conditions';
import { formatDate, isInMonth } from './date';
import { createEmptyShift, normalizeDays } from './editing';
import type { DateStr, DayMark, MonthConditions, MonthShift, YearMonth } from './types';

/** 取り込む画像の種類 */
export type ImportKind = 'wish' | 'shift' | 'calendar' | 'fortune';

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  wish: '勤務希望表',
  shift: '完成済みのシフト表',
  calendar: 'カレンダー・予定表',
  fortune: '占いの運気カレンダー',
};

/** AI が読み取った1行分（API の返事そのままの形） */
export interface ReadEntry {
  date: string | null;
  raw_date: string;
  status: 'work' | 'off' | 'available' | 'unavailable' | 'event' | 'unknown';
  start: string | null;
  end: string | null;
  title: string;
  confidence: 'high' | 'medium' | 'low';
  problem: string | null;
}

export interface ReadResult {
  year_month: string | null;
  entries: ReadEntry[];
  unreadable: { text: string; reason: string }[];
}

/** 登録するときの扱い */
export type RowAction = 'off-request' | 'work-request' | 'unavailable' | 'shift-work' | 'shift-off' | 'fortune';

export const ROW_ACTION_LABEL: Record<RowAction, string> = {
  'off-request': '休み希望',
  'work-request': '勤務希望（出勤できる）',
  unavailable: '勤務できない・予定',
  'shift-work': '確定の出勤',
  'shift-off': '確定の休み',
  fortune: '占いの運気',
};

export const ACTIONS_FOR_KIND: Record<ImportKind, RowAction[]> = {
  wish: ['off-request', 'work-request', 'unavailable'],
  shift: ['shift-work', 'shift-off'],
  calendar: ['unavailable', 'off-request'],
  fortune: ['fortune'],
};

/** 確認画面の1行（ここで修正してから登録する） */
export interface ImportRow {
  id: string;
  /** どの画像から読んだか（例：「1枚目」） */
  source: string;
  include: boolean;
  date: DateStr | '';
  action: RowAction;
  start: string;
  end: string;
  note: string;
  /** 読み取りに失敗・自信がないときの説明（⚠️ で表示） */
  warning: string | null;
  /** 画像の文字（日付が読めなかったときの手がかり） */
  rawDate: string;
  /** すでに登録してある内容と重なるとき、どうするか */
  resolution: 'unset' | 'replace' | 'keep';
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (t: string | null | undefined): t is string => !!t && TIME.test(t);

/** 実在する日付か（2026-02-30 などをはじく） */
export function isRealDate(d: string | null | undefined): d is string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
}

/** "9:00" → "09:00"。読めなければ空文字 */
export function normalizeTime(t: string | null | undefined): string {
  if (!t) return '';
  const m = /^(\d{1,2})[:：](\d{2})$/.exec(t.trim());
  if (!m) return '';
  const v = `${m[1].padStart(2, '0')}:${m[2]}`;
  return TIME.test(v) ? v : '';
}

function defaultAction(kind: ImportKind, status: ReadEntry['status'], title = ''): RowAction | null {
  if (kind === 'fortune') return title.trim() ? 'fortune' : null;
  if (kind === 'shift') return status === 'work' ? 'shift-work' : status === 'off' ? 'shift-off' : null;
  if (kind === 'calendar') return status === 'event' || status === 'unavailable' ? 'unavailable' : status === 'off' ? 'off-request' : null;
  // 勤務希望表
  if (status === 'off') return 'off-request';
  if (status === 'unavailable' || status === 'event') return 'unavailable';
  if (status === 'available' || status === 'work') return 'work-request';
  return null;
}

let seq = 0;

/** 読み取り結果を確認用の行にする */
export function toRows(kind: ImportKind, result: ReadResult, source: string): ImportRow[] {
  return result.entries.map((e) => {
    const warnings: string[] = [];
    const date = isRealDate(e.date) ? e.date : '';
    if (!date) warnings.push(`日付が読み取れませんでした（画像の文字：「${e.raw_date || '不明'}」）`);
    const action = defaultAction(kind, e.status, e.title);
    if (!action) warnings.push(kind === 'fortune' ? '運気が読み取れませんでした' : '出勤・休み・予定のどれか判断できませんでした');
    const start = normalizeTime(e.start);
    const end = normalizeTime(e.end);
    if ((e.start && !start) || (e.end && !end)) warnings.push('時間が読み取れませんでした');
    if (action === 'shift-work' && (!start || !end)) warnings.push('勤務時間が読み取れませんでした');
    if (e.confidence === 'low') warnings.push('読み取りに自信がありません。元の画像と見比べてください');
    if (e.problem) warnings.push(e.problem);
    const timeNote = start && end ? `${start}〜${end}` : '';
    const note = kind === 'fortune' ? normalizeFortuneLabel(e.title) : [e.title, kind !== 'shift' ? timeNote : ''].filter(Boolean).join(' ');
    return {
      id: `row-${++seq}`,
      source,
      include: !!date && !!action,
      date,
      action: action ?? ACTIONS_FOR_KIND[kind][0],
      start,
      end,
      note,
      warning: warnings.length ? [...new Set(warnings)].join(' / ') : null,
      rawDate: e.raw_date,
      resolution: 'unset',
    };
  });
}

const isShiftAction = (a: RowAction) => a === 'shift-work' || a === 'shift-off';
/** 同じ日に並べてよい登録先の種類（シフト・日付の指定・運気は別々） */
const targetOf = (a: RowAction) => (isShiftAction(a) ? 'shift' : a === 'fortune' ? 'fortune' : 'mark');
export const monthOf = (date: DateStr): YearMonth => date.slice(0, 7);

/** 登録先の月ごとの、いまのデータ */
export interface MonthData {
  conditions?: MonthConditions;
  shift?: MonthShift;
}

/** すでに登録してある内容と重なる場合、その説明。重ならなければ null */
export function existingConflict(row: ImportRow, data: MonthData | undefined): string | null {
  if (!row.date) return null;
  if (isShiftAction(row.action)) {
    const day = data?.shift?.days.find((d) => d.date === row.date);
    if (!day || (!day.work && !day.locked)) return null;
    const newWork = row.action === 'shift-work';
    const same = day.work === newWork && (!newWork || (day.start === row.start && day.end === row.end));
    if (same) return null;
    return `登録済みのシフト：${day.work ? `出勤 ${day.start ?? ''}〜${day.end ?? ''}` : '休み'}${day.locked ? '（確定）' : ''}`;
  }
  if (row.action === 'fortune') {
    const f = data?.conditions?.fortunes?.find((x) => x.date === row.date);
    if (!f || f.label === normalizeFortuneLabel(row.note)) return null;
    return `登録済みの運気：${f.label}`;
  }
  const mark = data?.conditions?.dayMarks.find((m) => m.date === row.date);
  if (!mark) return null;
  const kind = row.action as DayMark['kind'];
  if (mark.kind === kind && (mark.note ?? '') === row.note) return null;
  const label = mark.kind === 'off-request' ? '休み希望' : mark.kind === 'unavailable' ? '勤務できない・予定' : '勤務希望';
  return `登録済み：${label}${mark.note ? `（${mark.note}）` : ''}`;
}

/** 取り込む行どうしで、同じ日付が重なっている行の id */
export function batchDuplicates(rows: ImportRow[]): Map<string, string[]> {
  const groups = new Map<string, ImportRow[]>();
  for (const r of rows) {
    if (!r.include || !r.date) continue;
    const key = `${r.date}|${targetOf(r.action)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const dup = new Map<string, string[]>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const r of g) dup.set(r.id, g.filter((x) => x !== r).map((x) => x.source));
  }
  return dup;
}

/** 登録できない理由の一覧（空なら登録できる） */
export function blockingIssues(rows: ImportRow[], data: Map<YearMonth, MonthData>): string[] {
  const issues: string[] = [];
  const included = rows.filter((r) => r.include);
  if (included.length === 0) issues.push('登録する行が選ばれていません');
  const noDate = included.filter((r) => !isRealDate(r.date)).length;
  if (noDate) issues.push(`日付が入っていない行が${noDate}件あります`);
  const noTime = included.filter((r) => r.action === 'shift-work' && (!isTime(r.start) || !isTime(r.end) || r.start === r.end)).length;
  if (noTime) issues.push(`勤務時間が入っていない出勤の行が${noTime}件あります`);
  const noLabel = included.filter((r) => r.action === 'fortune' && !normalizeFortuneLabel(r.note)).length;
  if (noLabel) issues.push(`運気の名前が空の行が${noLabel}件あります`);
  const dup = batchDuplicates(rows);
  if (dup.size) issues.push(`同じ日付の行が重なっています（${[...new Set(included.filter((r) => dup.has(r.id)).map((r) => formatDate(r.date as string)))].join('、')}）。どちらか一方のチェックを外してください`);
  const unresolved = included.filter((r) => r.resolution === 'unset' && existingConflict(r, data.get(monthOf(r.date as string))));
  if (unresolved.length) issues.push(`登録済みの内容と重なる行が${unresolved.length}件あります。「新しい内容にする」か「今のままにする」を選んでください`);
  return issues;
}

export interface ApplyResult {
  /** 月ごとの新しいデータ（変更があった月だけ） */
  updates: Map<YearMonth, { conditions?: MonthConditions; shift?: MonthShift }>;
  marks: number;
  shiftDays: number;
  fortunes: number;
  kept: number;
}

/**
 * 確認済みの行を登録用のデータに反映する。保存はしない（呼び出し側で保存する）。
 * makeConditions：その月の勤務条件がないときに作る方法（前月コピーなど）
 */
export function applyRows(rows: ImportRow[], data: Map<YearMonth, MonthData>, makeConditions: (month: YearMonth) => MonthConditions): ApplyResult {
  const updates: ApplyResult['updates'] = new Map();
  let marks = 0;
  let shiftDays = 0;
  let fortunes = 0;
  let kept = 0;
  for (const r of rows) {
    if (!r.include || !isRealDate(r.date)) continue;
    const month = monthOf(r.date);
    const current = data.get(month) ?? {};
    const upd = updates.get(month) ?? {};
    if (existingConflict(r, current) && r.resolution === 'keep') {
      kept++;
      continue;
    }
    if (isShiftAction(r.action)) {
      const base = upd.shift ?? (current.shift ? { ...current.shift, days: normalizeDays(month, current.shift.days) } : { ...createEmptyShift(month), patternName: '写真から取り込み' });
      const types = (upd.conditions ?? current.conditions)?.shiftTypes ?? [];
      const type = types.find((s) => s.start === r.start && s.end === r.end);
      const day =
        r.action === 'shift-work'
          ? { date: r.date, work: true, start: r.start, end: r.end, locked: true, ...(type ? { shiftTypeId: type.id } : {}) }
          : { date: r.date, work: false, locked: true };
      upd.shift = { ...base, days: base.days.map((d) => (d.date === r.date ? day : d)) };
      shiftDays++;
    } else if (r.action === 'fortune') {
      const base = upd.conditions ?? current.conditions ?? makeConditions(month);
      const others = (base.fortunes ?? []).filter((f) => f.date !== r.date);
      const next = [...others, { date: r.date, label: normalizeFortuneLabel(r.note) }].sort((a, b) => a.date.localeCompare(b.date));
      upd.conditions = { ...base, fortunes: next };
      fortunes++;
    } else {
      const base = upd.conditions ?? current.conditions ?? makeConditions(month);
      const marksNext = setDayMark(base.dayMarks, r.date, r.action as DayMark['kind']).map((m) =>
        m.date === r.date ? { ...m, ...(r.note ? { note: r.note } : { note: undefined }) } : m,
      );
      upd.conditions = { ...base, dayMarks: marksNext.map(({ note, ...m }) => (note ? { ...m, note } : m)) };
      marks++;
    }
    updates.set(month, upd);
  }
  return { updates, marks, shiftDays, fortunes, kept };
}

/** 読み取った年月が、いま開いている月と違うときの注意 */
export function monthWarning(rows: ImportRow[], viewing: YearMonth): string | null {
  const others = [...new Set(rows.filter((r) => r.date && !isInMonth(r.date, viewing)).map((r) => monthOf(r.date as string)))];
  return others.length ? `${others.join('、')} の日付が含まれています。それぞれの月に登録されます` : null;
}
