// 日本の祝日の判定（@holiday-jp/holiday_jp のデータを使用。2050年まで対応）
import holidayJp from '@holiday-jp/holiday_jp';
import { weekdayOf } from './date';
import type { DateStr } from './types';

let cache: Map<DateStr, string> | null = null;

function holidayMap(): Map<DateStr, string> {
  if (!cache) {
    cache = new Map();
    // データの日付は「UTCの0時」なので、ISO形式の先頭10文字がそのまま日付になる
    for (const h of holidayJp.between(new Date('2000-01-01T00:00:00Z'), new Date('2051-01-01T00:00:00Z'))) {
      cache.set(h.date.toISOString().slice(0, 10), h.name);
    }
  }
  return cache;
}

/** 祝日なら祝日名、そうでなければ undefined */
export function holidayName(date: DateStr): string | undefined {
  return holidayMap().get(date);
}

/** 土曜・日曜・祝日のどれか */
export function isWeekendOrHoliday(date: DateStr): boolean {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6 || holidayMap().has(date);
}
