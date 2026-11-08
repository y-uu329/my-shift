// データのバックアップ（書き出し・読み込み）。APIキーは含めない
export const BACKUP_APP = 'my-shift-app';
export const BACKUP_VERSION = 1;

/** バックアップに入れてよいデータの種類（保存キーの先頭） */
const ALLOWED = [/^conditions:\d{4}-\d{2}$/, /^shift:\d{4}-\d{2}$/, /^shift-history:\d{4}-\d{2}$/, /^settings$/];
export const isBackupKey = (key: string) => ALLOWED.some((r) => r.test(key));

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
}

export function buildBackup(entries: [string, unknown][], now = new Date()): BackupFile {
  const data: Record<string, unknown> = {};
  for (const [k, v] of entries) if (isBackupKey(k)) data[k] = v;
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
}

export interface BackupSummary {
  months: string[];
  shifts: number;
  hasSettings: boolean;
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  const keys = Object.keys(b.data);
  const months = [...new Set(keys.filter((k) => k.startsWith('conditions:') || k.startsWith('shift:')).map((k) => k.split(':')[1]))].sort();
  return { months, shifts: keys.filter((k) => k.startsWith('shift:')).length, hasSettings: keys.includes('settings') };
}

/** ファイルの中身を確かめる。問題があればエラーの説明を投げる */
export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('ファイルの形式が正しくありません（マイシフトのバックアップファイルを選んでください）');
  }
  const b = obj as Partial<BackupFile>;
  if (!b || b.app !== BACKUP_APP || typeof b.data !== 'object' || b.data === null) throw new Error('マイシフトのバックアップファイルではありません');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new Error('新しいバージョンのアプリで作られたファイルです。アプリを更新してから読み込んでください');
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b.data)) if (isBackupKey(k) && v && typeof v === 'object') data[k] = v;
  if (Object.keys(data).length === 0) throw new Error('読み込めるデータが入っていません');
  return { app: BACKUP_APP, version: b.version, exportedAt: String(b.exportedAt ?? ''), data };
}
