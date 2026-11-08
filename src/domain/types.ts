// =============================================
// アプリ全体で使う「データの形」の定義
// =============================================

/** "2026-12" のような年月の文字列 */
export type YearMonth = string;
/** "2026-12-05" のような日付の文字列 */
export type DateStr = string;
/** "09:00" のような時刻の文字列 */
export type TimeStr = string;

/** 条件の優先度  A: 絶対に守る / B: できるだけ守る / C: 可能なら反映 */
export type Priority = 'A' | 'B' | 'C';

/** 早番・遅番などの勤務区分 */
export interface ShiftType {
  id: string;
  name: string;
  start: TimeStr;
  end: TimeStr;
  /** カレンダーで使う色 */
  color: string;
}

/** 日付ごとの指定の種類 */
export type DayMarkKind =
  | 'off-request' // 休み希望（B）
  | 'unavailable' // 勤務できない日（A）
  | 'work-request'; // 特定の日の勤務希望（B）

export interface DayMark {
  date: DateStr;
  kind: DayMarkKind;
  /** 勤務希望のとき、希望する勤務区分（任意） */
  shiftTypeId?: string;
  /** メモ（任意） */
  note?: string;
}

/** 占いの運気（例：ゲッターズ飯田さんの月間運気カレンダー）1日分 */
export interface FortuneDay {
  date: DateStr;
  /** 運気の名前（例：「開運」「乱気」）。「の日」は付けない */
  label: string;
}

/** 運気ごとの希望 1=出勤したい 0=どちらでもない -1=休みたい */
export type FortunePref = -1 | 0 | 1;

/** 連休の希望 */
export interface ConsecutiveOffWish {
  enabled: boolean;
  /** 何連休したいか（例：2 → 2連休） */
  length: number;
  /** その連休を月に何回ほしいか */
  times: number;
}

/**
 * 曜日の並びは JavaScript に合わせて 0=日, 1=月, … 6=土
 */
export type WeekdayFlags = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
/** 曜日ごとの出勤優先度 0=なるべく避けたい 1=ふつう 2=できれば入りたい 3=ぜひ入りたい */
export type WeekdayPriorities = [number, number, number, number, number, number, number];

/** 1か月分の勤務条件 */
export interface MonthConditions {
  /** データ形式のバージョン（将来の変更に備える） */
  version: 1;
  month: YearMonth;

  // --- 日数 ---
  /** 月の希望出勤日数（未設定なら null） */
  monthlyDays: number | null;
  /** 週の希望出勤日数（未設定なら null） */
  weeklyDays: number | null;

  // --- 曜日 ---
  /** 出勤可能な曜日 */
  availableWeekdays: WeekdayFlags;
  /** 曜日ごとの出勤優先度 */
  weekdayPriorities: WeekdayPriorities;

  // --- 時間・勤務区分 ---
  /** 勤務できる時間帯の開始 */
  workStart: TimeStr;
  /** 勤務できる時間帯の終了 */
  workEnd: TimeStr;
  /** 早番・遅番などの勤務区分 */
  shiftTypes: ShiftType[];
  /** 1日の希望勤務時間（時間、未設定なら null） */
  preferredHoursPerDay: number | null;

  // --- 連勤・連休 ---
  /** 連勤の最大日数 */
  maxConsecutiveDays: number;
  /** 連休の希望 */
  consecutiveOff: ConsecutiveOffWish;

  // --- 土日祝 ---
  /** 土日祝の希望出勤回数（未設定なら null） */
  weekendHolidayDays: number | null;

  // --- 日付ごとの指定（休み希望・勤務不可・勤務希望） ---
  dayMarks: DayMark[];

  /** 占いの運気（月ごと。写真から取り込む） */
  fortunes?: FortuneDay[];
  /** 運気ごとの希望（翌月にも引き継ぐ） */
  fortunePrefs?: Record<string, FortunePref>;

  /** 自由メモ */
  memo: string;

  /** 最終更新日時（ISO形式） */
  updatedAt: string;
}

/** 条件の項目名（優先度の表示に使う） */
export type ConditionKey =
  | 'unavailable'
  | 'fixedSchedule'
  | 'maxConsecutiveDays'
  | 'workHours'
  | 'availableWeekdays'
  | 'monthlyDays'
  | 'weeklyDays'
  | 'offRequest'
  | 'workRequest'
  | 'consecutiveOff'
  | 'weekendHolidayDays'
  | 'weekdayPriorities'
  | 'preferredHours'
  | 'fortune'
  | 'hoursBalance';

// =============================================
// シフト（作成結果）
// =============================================

/** 1日分の勤務 */
export interface DayAssignment {
  date: DateStr;
  work: boolean;
  /** 勤務区分（区分を使わない勤務なら undefined） */
  shiftTypeId?: string;
  start?: TimeStr;
  end?: TimeStr;
  /** 確定済み（再作成しても変えない日）。カレンダーで手動で付ける */
  locked?: boolean;
}

/** 確定済みの予定（A：必ず守る）。写真の読み取りや手動入力から登録する */
export interface FixedDay {
  date: DateStr;
  work: boolean;
  start?: TimeStr;
  end?: TimeStr;
  shiftTypeId?: string;
  /** どこから来た情報か（例：「シフト表の写真」） */
  source: string;
}

/** 1か月分の確定シフト */
export interface MonthShift {
  version: 1;
  month: YearMonth;
  days: DayAssignment[];
  /** 自動作成のどのパターンから採用したか */
  patternName?: string;
  createdAt: string;
  updatedAt: string;
}
