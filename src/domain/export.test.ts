import { describe, expect, it } from 'vitest';
import { createDefaultConditions } from './conditions';
import { createEmptyShift } from './editing';
import { buildCsv, pdfFromJpeg } from './export';
import { DEFAULT_PAY } from './pay';

describe('CSV出力', () => {
  it('全日分の行と合計行があり、Excel用のBOMが付く', () => {
    const c = createDefaultConditions('2026-12');
    c.dayMarks = [{ date: '2026-12-02', kind: 'off-request', note: '通院, 午後' }];
    const shift = createEmptyShift('2026-12');
    shift.days[0] = { date: '2026-12-01', work: true, shiftTypeId: 'early', start: '09:00', end: '17:00', locked: true };
    shift.days[2] = { date: '2026-12-03', work: true, start: '10:00', end: '15:30' };
    const csv = buildCsv(shift, c);
    expect(csv.startsWith('﻿日付,曜日')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 31 + 1);
    expect(lines[1]).toBe('2026-12-01,火,,出勤,早番,09:00,17:00,8,確定,,');
    expect(lines[2]).toBe('2026-12-02,水,,休み,,,,,,休み希望,"通院, 午後"');
    expect(lines[3]).toContain('時間指定,10:00,15:30,5.5');
    expect(lines[32]).toBe('合計,,,2日,,,,13.5,,,');
  });

  it('祝日名が入る', () => {
    const csv = buildCsv(createEmptyShift('2027-01'));
    expect(csv).toContain('2027-01-01,金,元日,休み');
  });
});

describe('CSV出力（給料つき）', () => {
  it('休憩・実働・給料の列と合計が入る', () => {
    const shift = createEmptyShift('2026-12');
    shift.days[0] = { date: '2026-12-01', work: true, start: '09:00', end: '17:00' };
    shift.days[1] = { date: '2026-12-02', work: true, start: '09:00', end: '18:00' };
    const lines = buildCsv(shift, undefined, DEFAULT_PAY).trim().split('\r\n');
    expect(lines[0].endsWith('休憩(分),実働時間,給料(円)')).toBe(true);
    expect(lines[1].endsWith(',60,7,10780')).toBe(true);
    expect(lines[2].endsWith(',90,7.5,11550')).toBe(true);
    expect(lines[3].endsWith(',,,')).toBe(true);
    expect(lines[32].endsWith(',150,14.5,22330')).toBe(true);
  });
});

describe('PDF出力', () => {
  it('PDFの形式になっていて、目次（xref）の位置が正しい', () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = pdfFromJpeg(fakeJpeg, 1600, 1100);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 842 595]'); // 横長の画像は横向き
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // 各オブジェクトの位置が xref と一致する
    const entries = [...text.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('縦長の画像は縦向き', () => {
    const text = new TextDecoder('latin1').decode(pdfFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 800, 1200));
    expect(text).toContain('/MediaBox [0 0 595 842]');
  });
});
