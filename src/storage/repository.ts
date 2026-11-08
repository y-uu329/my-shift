// 端末内（ブラウザの IndexedDB）にデータを保存・読み込みする係
// ※ データは「この端末のこのブラウザ」の中だけに保存されます。
// ※ プライベートブラウズなどで保存が使えないときは、一時的にメモリに保存します（ページを閉じると消えます）。
import * as idb from 'idb-keyval';
import { DEFAULT_SETTINGS, type AppSettings } from '../domain/settings';
import type { MonthConditions, MonthShift, YearMonth } from '../domain/types';

let store: idb.UseStore | null = null;
const memory = new Map<string, unknown>();
let persistent = true;
const listeners = new Set<(ok: boolean) => void>();

/** 端末に保存できているか（false ならページを閉じるとデータが消える） */
export function isPersistent() {
  return persistent;
}
export function onPersistenceChange(fn: (ok: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function fallback(err: unknown) {
  if (persistent) {
    console.warn('端末への保存が使えないため、一時保存に切り替えます', err);
    persistent = false;
    listeners.forEach((fn) => fn(false));
  }
}
function getStore() {
  if (!store) store = idb.createStore('my-shift-app', 'data');
  return store;
}
/** IndexedDB が反応しないときに待ち続けないための時間制限 */
function withTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function get<T>(key: string): Promise<T | undefined> {
  if (persistent) {
    try {
      return await withTimeout(idb.get<T>(key, getStore()));
    } catch (e) {
      fallback(e);
    }
  }
  return memory.get(key) as T | undefined;
}
async function set(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  if (!persistent) return;
  try {
    await withTimeout(idb.set(key, value, getStore()));
  } catch (e) {
    fallback(e);
  }
}
async function del(key: string): Promise<void> {
  memory.delete(key);
  if (!persistent) return;
  try {
    await withTimeout(idb.del(key, getStore()));
  } catch (e) {
    fallback(e);
  }
}
async function keys(): Promise<string[]> {
  if (persistent) {
    try {
      return (await withTimeout(idb.keys(getStore()))).map(String);
    } catch (e) {
      fallback(e);
    }
  }
  return [...memory.keys()];
}

const CONDITIONS_PREFIX = 'conditions:';

export async function loadConditions(month: YearMonth): Promise<MonthConditions | undefined> {
  return get<MonthConditions>(CONDITIONS_PREFIX + month);
}

export async function saveConditions(c: MonthConditions): Promise<MonthConditions> {
  const saved = { ...c, updatedAt: new Date().toISOString() };
  await set(CONDITIONS_PREFIX + c.month, saved);
  return saved;
}

export async function deleteConditions(month: YearMonth): Promise<void> {
  await del(CONDITIONS_PREFIX + month);
}

/** 条件が保存されている月の一覧（新しい順） */
export async function listConditionMonths(): Promise<YearMonth[]> {
  const all = await keys();
  return all
    .map(String)
    .filter((k) => k.startsWith(CONDITIONS_PREFIX))
    .map((k) => k.slice(CONDITIONS_PREFIX.length))
    .sort()
    .reverse();
}

/** 指定した月より前で、いちばん近い月の条件（前月コピー用） */
export async function findLatestConditionsBefore(month: YearMonth): Promise<MonthConditions | undefined> {
  const months = await listConditionMonths();
  const prev = months.find((m) => m < month);
  return prev ? loadConditions(prev) : undefined;
}

// ---------- シフト ----------

const SHIFT_PREFIX = 'shift:';
const HISTORY_PREFIX = 'shift-history:';
const HISTORY_LIMIT = 20;

export async function loadShift(month: YearMonth): Promise<MonthShift | undefined> {
  return get<MonthShift>(SHIFT_PREFIX + month);
}

/** シフトを保存する。すでにあるシフトは消さずに履歴へ移す */
export async function saveShift(shift: MonthShift): Promise<MonthShift> {
  const previous = await loadShift(shift.month);
  if (previous) {
    const history = (await loadShiftHistory(shift.month)).slice(0, HISTORY_LIMIT - 1);
    await set(HISTORY_PREFIX + shift.month, [previous, ...history]);
  }
  const saved = { ...shift, updatedAt: new Date().toISOString() };
  await set(SHIFT_PREFIX + shift.month, saved);
  return saved;
}

/** 手動編集の自動保存用。履歴は増やさずに今のシフトを上書きする */
export async function updateShift(shift: MonthShift): Promise<MonthShift> {
  const saved = { ...shift, updatedAt: new Date().toISOString() };
  await set(SHIFT_PREFIX + shift.month, saved);
  return saved;
}

/** 過去に保存したシフト（新しい順） */
export async function loadShiftHistory(month: YearMonth): Promise<MonthShift[]> {
  return (await get<MonthShift[]>(HISTORY_PREFIX + month)) ?? [];
}

/** 月末に何日連続で出勤しているか（翌月の連勤上限の判定に使う） */
export function trailingWorkStreak(shift: MonthShift | undefined): number {
  if (!shift) return 0;
  let n = 0;
  for (let i = shift.days.length - 1; i >= 0 && shift.days[i].work; i--) n++;
  return n;
}

/** シフトが保存されている月の一覧（新しい順） */
export async function listShiftMonths(): Promise<YearMonth[]> {
  return (await keys())
    .filter((k) => k.startsWith(SHIFT_PREFIX))
    .map((k) => k.slice(SHIFT_PREFIX.length))
    .sort()
    .reverse();
}

/**
 * 履歴の版を今のシフトに戻す。今のシフトは消さずに履歴の先頭へ移す。
 * index は loadShiftHistory の並び（0 がいちばん新しい履歴）
 */
export async function restoreFromHistory(month: YearMonth, index: number): Promise<MonthShift | undefined> {
  const history = await loadShiftHistory(month);
  const target = history[index];
  if (!target) return undefined;
  const current = await loadShift(month);
  const rest = history.filter((_, i) => i !== index);
  await set(HISTORY_PREFIX + month, (current ? [current, ...rest] : rest).slice(0, HISTORY_LIMIT));
  const restored = { ...target, updatedAt: new Date().toISOString() };
  await set(SHIFT_PREFIX + month, restored);
  return restored;
}

// ---------- 設定 ----------
const SETTINGS_KEY = 'settings';
/** APIキーは設定とは別の場所に保存する（CSVなどの出力には含めない） */
const API_KEY_KEY = 'secret:anthropic-api-key';

export async function loadSettings(): Promise<AppSettings> {
  const s = await get<AppSettings>(SETTINGS_KEY);
  return s ? { ...DEFAULT_SETTINGS, ...s, pay: { ...DEFAULT_SETTINGS.pay, ...s.pay } } : DEFAULT_SETTINGS;
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await set(SETTINGS_KEY, s);
}

/** この端末に保存した Claude の APIキー（なければ undefined） */
export async function loadApiKey(): Promise<string | undefined> {
  return get<string>(API_KEY_KEY);
}

export async function saveApiKey(key: string): Promise<void> {
  await set(API_KEY_KEY, key.trim());
}

export async function deleteApiKey(): Promise<void> {
  await del(API_KEY_KEY);
}

// ---------- バックアップ ----------

/** 保存しているデータをすべて取り出す（APIキーなどは呼び出し側で除く） */
export async function dumpAll(): Promise<[string, unknown][]> {
  const all = await keys();
  return Promise.all(all.map(async (k) => [k, await get<unknown>(k)] as [string, unknown]));
}

/** バックアップのデータを書き込む（同じ月のデータは置き換え、ほかの月はそのまま） */
export async function restoreAll(data: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(data)) await set(k, v);
}

/** 端末の保存領域が「消されにくい設定」になっているか */
export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}
