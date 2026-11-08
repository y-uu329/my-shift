import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, summarizeBackup } from './backup';

describe('バックアップ', () => {
  const entries: [string, unknown][] = [
    ['conditions:2026-12', { month: '2026-12' }],
    ['shift:2026-12', { month: '2026-12' }],
    ['shift-history:2026-12', [{ month: '2026-12' }]],
    ['settings', { version: 1 }],
    ['secret:anthropic-api-key', 'sk-ant-secret'],
  ];

  it('APIキーは書き出さない', () => {
    const b = buildBackup(entries, new Date('2026-11-08T00:00:00Z'));
    expect(Object.keys(b.data).sort()).toEqual(['conditions:2026-12', 'settings', 'shift-history:2026-12', 'shift:2026-12']);
    expect(JSON.stringify(b)).not.toContain('sk-ant');
  });

  it('書き出したものを読み込める', () => {
    const text = JSON.stringify(buildBackup(entries));
    const b = parseBackup(text);
    expect(summarizeBackup(b)).toEqual({ months: ['2026-12'], shifts: 1, hasSettings: true });
  });

  it('関係ないファイル・壊れたファイル・知らないデータははじく', () => {
    expect(() => parseBackup('not json')).toThrow('形式が正しくありません');
    expect(() => parseBackup('{"app":"other","data":{}}')).toThrow('バックアップファイルではありません');
    expect(() => parseBackup('{"app":"my-shift-app","version":99,"data":{"settings":{}}}')).toThrow('新しいバージョン');
    const b = parseBackup(JSON.stringify({ app: 'my-shift-app', version: 1, data: { settings: {}, 'secret:anthropic-api-key': 'x', evil: {} } }));
    expect(Object.keys(b.data)).toEqual(['settings']);
  });
});
