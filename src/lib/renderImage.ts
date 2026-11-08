// シフトの月間カレンダーを画像（canvas）に描く。画面のデザインに頼らず、いつも同じ見た目で出力する
import { datesOfMonth, durationHours, formatYearMonth, WEEKDAY_LABELS, weekdayOf } from '../domain/date';
import { computeStats } from '../domain/generator';
import { holidayName } from '../domain/holidays';
import { hm, monthPay, type PaySettings } from '../domain/pay';
import type { MonthConditions, MonthShift } from '../domain/types';

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
const C = {
  bg: '#ffffff',
  text: '#1d2433',
  muted: '#667085',
  border: '#dfe3ec',
  off: '#f1f3f8',
  sun: '#d93f45',
  sat: '#2f6fe0',
  offReq: '#0f9f6e',
  ng: '#d93f45',
  want: '#c77700',
};

function rgba(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(79,109,245,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function renderShiftCanvas(shift: MonthShift, conditions: MonthConditions, pay?: PaySettings): HTMLCanvasElement {
  const W = 1600;
  const pad = 48;
  const gap = 8;
  const cellW = (W - pad * 2 - gap * 6) / 7;
  const cellH = 150;
  const dates = datesOfMonth(shift.month);
  const leading = (weekdayOf(dates[0]) + 6) % 7;
  const rows = Math.ceil((leading + dates.length) / 7);
  const gridTop = pad + 130;
  const H = gridTop + 50 + rows * (cellH + gap) + 70 + pad;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';

  const stats = computeStats(conditions, shift.days);
  ctx.fillStyle = C.text;
  ctx.font = `bold 46px ${FONT}`;
  ctx.fillText(`${formatYearMonth(shift.month)} シフト`, pad, pad);
  ctx.fillStyle = C.muted;
  ctx.font = `26px ${FONT}`;
  const mp = pay ? monthPay(shift.days, pay) : null;
  ctx.fillText(
    `出勤 ${stats.workDays}日 ・ 休み ${stats.offDays}日 ・ ${mp ? `実働 ${hm(mp.workHours)} ・ 見込み給料 ${mp.pay.toLocaleString('ja-JP')}円` : `合計 ${stats.totalHours}時間`} ・ 土日祝の出勤 ${stats.weekendHolidayWork}回`,
    pad,
    pad + 68,
  );

  // 曜日の見出し（月曜始まり）
  [1, 2, 3, 4, 5, 6, 0].forEach((wd, col) => {
    ctx.fillStyle = wd === 0 ? C.sun : wd === 6 ? C.sat : C.text;
    ctx.font = `bold 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(WEEKDAY_LABELS[wd], pad + col * (cellW + gap) + cellW / 2, gridTop + 8);
  });
  ctx.textAlign = 'left';

  const byDate = new Map(shift.days.map((d) => [d.date, d]));
  const marks = new Map(conditions.dayMarks.map((m) => [m.date, m]));
  const types = new Map(conditions.shiftTypes.map((s) => [s.id, s]));
  const fortunes = new Map((conditions.fortunes ?? []).map((f) => [f.date, f.label]));

  dates.forEach((date, i) => {
    const pos = leading + i;
    const x = pad + (pos % 7) * (cellW + gap);
    const y = gridTop + 50 + Math.floor(pos / 7) * (cellH + gap);
    const d = byDate.get(date);
    const type = d?.shiftTypeId ? types.get(d.shiftTypeId) : undefined;
    const color = type?.color ?? '#4f6df5';
    roundRect(ctx, x, y, cellW, cellH, 14);
    ctx.fillStyle = d?.work ? rgba(color, 0.16) : C.off;
    ctx.fill();
    ctx.strokeStyle = d?.work ? rgba(color, 0.6) : C.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    const wd = weekdayOf(date);
    const holiday = holidayName(date);
    ctx.fillStyle = holiday || wd === 0 ? C.sun : wd === 6 ? C.sat : C.text;
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillText(String(Number(date.slice(8))), x + 14, y + 12);
    if (d?.locked) {
      ctx.fillStyle = C.muted;
      ctx.font = `bold 18px ${FONT}`;
      ctx.fillText('確定', x + 62, y + 20);
    }

    const mark = marks.get(date);
    if (mark) {
      const label = mark.kind === 'off-request' ? '休希望' : mark.kind === 'unavailable' ? '不可' : '勤希望';
      const tone = mark.kind === 'off-request' ? C.offReq : mark.kind === 'unavailable' ? C.ng : C.want;
      ctx.font = `bold 18px ${FONT}`;
      const tw = ctx.measureText(label).width + 14;
      roundRect(ctx, x + cellW - tw - 10, y + 14, tw, 28, 8);
      ctx.fillStyle = rgba(tone, 0.14);
      ctx.fill();
      ctx.fillStyle = tone;
      ctx.fillText(label, x + cellW - tw - 3, y + 18);
    }
    const fortune = fortunes.get(date);
    if (fortune) {
      ctx.fillStyle = C.muted;
      ctx.font = `18px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`運気:${fortune}`, x + cellW - 12, y + 48);
      ctx.textAlign = 'left';
    }
    if (holiday) {
      ctx.fillStyle = C.sun;
      ctx.font = `18px ${FONT}`;
      ctx.fillText(holiday.slice(0, 8), x + 14, y + 48);
    }

    if (d?.work) {
      ctx.fillStyle = C.text;
      ctx.font = `bold 28px ${FONT}`;
      ctx.fillText(type?.name ?? '出勤', x + 14, y + 74);
      if (d.start && d.end) {
        ctx.font = `24px ${FONT}`;
        ctx.fillText(`${d.start}–${d.end}`, x + 14, y + 110);
        ctx.fillStyle = C.muted;
        ctx.font = `18px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${durationHours(d.start, d.end)}h`, x + cellW - 12, y + 116);
        ctx.textAlign = 'left';
      }
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = `26px ${FONT}`;
      ctx.fillText('休み', x + 14, y + 80);
    }
  });

  // 下の凡例（勤務区分ごとの回数）
  let lx = pad;
  const ly = H - pad - 34;
  ctx.font = `22px ${FONT}`;
  for (const s of stats.byShiftType) {
    ctx.fillStyle = s.color;
    roundRect(ctx, lx, ly + 4, 22, 22, 5);
    ctx.fill();
    ctx.fillStyle = C.text;
    const label = `${s.name} ${s.count}回`;
    ctx.fillText(label, lx + 30, ly + 2);
    lx += 30 + ctx.measureText(label).width + 28;
  }
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.fillText(shift.patternName ? `マイシフト（${shift.patternName}）` : 'マイシフト', W - pad, ly + 2);
  ctx.textAlign = 'left';
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), type, quality));
}
