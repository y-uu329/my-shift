// 出力（CSV・PDF）のデータを作る。画面やブラウザに頼らない部分だけをここに置く
import { DAY_MARK_LABEL } from './conditions';
import { durationHours, WEEKDAY_LABELS, weekdayOf } from './date';
import { holidayName } from './holidays';
import { dayPay, monthPay, type PaySettings } from './pay';
import type { MonthConditions, MonthShift } from './types';

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV（Excel や Numbers で開ける表）を作る。
 * 先頭に BOM を付けて、Excel で開いても文字化けしないようにする。
 */
export function buildCsv(shift: MonthShift, conditions?: MonthConditions, pay?: PaySettings): string {
  const types = new Map((conditions?.shiftTypes ?? []).map((s) => [s.id, s.name]));
  const marks = new Map((conditions?.dayMarks ?? []).map((m) => [m.date, m]));
  const fortunes = new Map((conditions?.fortunes ?? []).map((f) => [f.date, f.label]));
  const withFortune = fortunes.size > 0;
  const header = ['日付', '曜日', '祝日', '勤務', '勤務区分', '開始', '終了', '勤務時間', '確定', '希望・予定', 'メモ', ...(withFortune ? ['運気'] : []), ...(pay ? ['休憩(分)', '実働時間', '給料(円)'] : [])];
  let workDays = 0;
  let totalHours = 0;
  const rows = shift.days.map((d) => {
    const hours = d.work && d.start && d.end ? durationHours(d.start, d.end) : 0;
    if (d.work) workDays++;
    totalHours += hours;
    const mark = marks.get(d.date);
    return [
      d.date,
      WEEKDAY_LABELS[weekdayOf(d.date)],
      holidayName(d.date) ?? '',
      d.work ? '出勤' : '休み',
      d.work ? (d.shiftTypeId ? (types.get(d.shiftTypeId) ?? '') : '時間指定') : '',
      d.work ? (d.start ?? '') : '',
      d.work ? (d.end ?? '') : '',
      d.work ? hours : '',
      d.locked ? '確定' : '',
      mark ? DAY_MARK_LABEL[mark.kind] : '',
      mark?.note ?? '',
      ...(withFortune ? [fortunes.get(d.date) ?? ''] : []),
      ...(pay ? (d.work && d.start && d.end ? (() => { const p = dayPay(d, pay); return [p.breakMinutes, p.workHours, p.pay]; })() : ['', '', '']) : []),
    ];
  });
  const mp = pay ? monthPay(shift.days, pay) : null;
  const total = ['合計', '', '', `${workDays}日`, '', '', '', totalHours, '', '', '', ...(withFortune ? [''] : []), ...(mp ? [mp.breakHours * 60, mp.workHours, mp.pay] : [])];
  return '﻿' + [header, ...rows, total].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** ファイル名（日本語だと一部のブラウザで「download」になってしまうため英数字にする） 例：shift_2026-12.pdf */
export function exportFileName(shift: MonthShift, ext: string): string {
  return `shift_${shift.month}.${ext}`;
}

/**
 * JPEG 画像を1ページに貼った PDF を作る（A4。画像の縦横に合わせて向きを決める）。
 * 文字は画像として入るので、日本語フォントの問題が起きない。
 */
export function pdfFromJpeg(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const landscape = width >= height;
  const pageW = landscape ? 842 : 595;
  const pageH = landscape ? 595 : 842;
  const margin = 28;
  const scale = Math.min((pageW - margin * 2) / width, (pageH - margin * 2) / height);
  const drawW = +(width * scale).toFixed(2);
  const drawH = +(height * scale).toFixed(2);
  const x = +((pageW - drawW) / 2).toFixed(2);
  const y = +((pageH - drawH) / 2).toFixed(2);

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${drawW} 0 0 ${drawH} ${x} ${y} cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
