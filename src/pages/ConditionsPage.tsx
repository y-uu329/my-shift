// 勤務条件の登録・編集画面
import { useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../components/ConfirmDialog';
import { DayMarkCalendar } from '../components/DayMarkCalendar';
import { ShiftTypeEditor } from '../components/ShiftTypeEditor';
import { Field, Section, Stepper, Toggle } from '../components/ui';
import {
  CONDITION_PRIORITY as P,
  copyConditionsToMonth,
  countWorkableDays,
  createDefaultConditions,
  createSampleConditions,
  fortuneLabels,
  validateConditions,
} from '../domain/conditions';
import { daysInMonth, formatDate, formatYearMonth, WEEKDAY_LABELS } from '../domain/date';
import type { MonthConditions, YearMonth } from '../domain/types';
import { findLatestConditionsBefore, loadConditions, saveConditions } from '../storage/repository';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜始まりで表示
const PRIORITY_LEVELS = ['避けたい', 'ふつう', 'できれば', 'ぜひ'];

type LoadState =
  | { status: 'loading' }
  | { status: 'empty'; previous?: MonthConditions }
  | { status: 'ready'; saved: MonthConditions; previous?: MonthConditions };

export function ConditionsPage({ month, onDirtyChange }: { month: YearMonth; onDirtyChange: (dirty: boolean) => void }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [draft, setDraft] = useState<MonthConditions | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 月が変わったら、その月の条件を読み込む
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setDraft(null);
    setMessage(null);
    Promise.all([loadConditions(month), findLatestConditionsBefore(month)]).then(([saved, previous]) => {
      if (cancelled) return;
      if (saved) {
        setState({ status: 'ready', saved, previous });
        setDraft(saved);
      } else {
        setState({ status: 'empty', previous });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const saved = state.status === 'ready' ? state.saved : null;
  const dirty = draft !== null && (saved === null || JSON.stringify(stripTime(draft)) !== JSON.stringify(stripTime(saved)));
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // 保存していない変更があるときに、ページを閉じようとしたら確認する
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const issues = useMemo(() => (draft ? validateConditions(draft) : []), [draft]);
  const errors = issues.filter((i) => i.level === 'error');

  if (state.status === 'loading') return <p className="muted center">読み込み中…</p>;

  const previous = state.previous;

  if (draft === null) {
    return (
      <div className="empty card">
        <h2>{formatYearMonth(month)}の勤務条件はまだありません</h2>
        <p className="muted">はじめに条件を作りましょう。前の月の条件があれば、それを引き継ぐこともできます。</p>
        <div className="empty-actions">
          {previous && (
            <button type="button" className="btn btn-primary" onClick={() => setDraft(copyConditionsToMonth(previous, month))}>
              {formatYearMonth(previous.month)}の条件をコピーして作る
            </button>
          )}
          <button type="button" className={`btn ${previous ? 'btn-ghost' : 'btn-primary'}`} onClick={() => setDraft(createDefaultConditions(month))}>
            新しく条件を作る
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(createSampleConditions(month))}>
            サンプルの条件で試す
          </button>
        </div>
        {previous && <p className="field-hint">※ コピーするのは「いつもの設定」です。休み希望日などの日付の指定はコピーしません。</p>}
        {!previous && (
          <ol className="first-steps" aria-label="使い方の流れ">
            <li>
              <span>
                <strong>勤務条件を登録</strong>
                <small>月・週の出勤日数、休み希望、勤務できない日、勤務時間など</small>
              </span>
            </li>
            <li>
              <span>
                <strong>写真から取り込み（任意）</strong>
                <small>勤務希望表・シフト表・予定表・占いの運気カレンダーを写真で</small>
              </span>
            </li>
            <li>
              <span>
                <strong>シフト作成</strong>
                <small>考え方の違う3パターンから選んで保存</small>
              </span>
            </li>
            <li>
              <span>
                <strong>カレンダーで確認・調整</strong>
                <small>日付をタップして直す。見込みの給料も表示</small>
              </span>
            </li>
            <li>
              <span>
                <strong>履歴・出力</strong>
                <small>PDF・画像・CSVで保存</small>
              </span>
            </li>
          </ol>
        )}
      </div>
    );
  }

  const patch = (p: Partial<MonthConditions>) => setDraft({ ...draft, ...p });
  const fieldIssues = (field: string) =>
    issues
      .filter((i) => i.field === field)
      .map((i, idx) => (
        <p key={idx} className={`issue issue-${i.level}`}>
          {i.level === 'error' ? '⛔' : '⚠️'} {i.message}
        </p>
      ));

  const save = async () => {
    if (errors.length > 0) return;
    const result = await saveConditions(draft);
    setState({ status: 'ready', saved: result, previous });
    setDraft(result);
    setMessage('保存しました');
    setTimeout(() => setMessage(null), 2500);
  };

  const copyFromPrevious = async () => {
    if (!previous) return;
    if (!(await confirmDialog(`${formatYearMonth(previous.month)}の「いつもの設定」で上書きします。この月の休み希望などの日付の指定はそのまま残します。`, '上書きする'))) return;
    const copied = copyConditionsToMonth(previous, month);
    setDraft({ ...copied, dayMarks: draft.dayMarks, memo: draft.memo });
  };

  const discard = async () => {
    if (!(await confirmDialog('保存していない変更を取り消して、元に戻します。', '元に戻す'))) return;
    if (saved) setDraft(saved);
    else setDraft(null);
  };

  const total = daysInMonth(month);
  const workable = countWorkableDays(draft);

  return (
    <div className="conditions">
      <div className="toolbar">
        <p className="muted">
          {saved ? `最終保存：${new Date(saved.updatedAt).toLocaleString('ja-JP')}` : 'まだ保存されていません'}
        </p>
        {previous && (
          <button type="button" className="btn btn-ghost" onClick={copyFromPrevious}>
            📋 {formatYearMonth(previous.month)}の条件をコピー
          </button>
        )}
      </div>

      <div className="summary-chips">
        <span className="chip">この月は {total} 日</span>
        <span className="chip">出勤できる日 最大 {workable} 日</span>
        <span className="chip">休み希望 {draft.dayMarks.filter((m) => m.kind === 'off-request').length} 日</span>
        <span className="chip">勤務できない日 {draft.dayMarks.filter((m) => m.kind === 'unavailable').length} 日</span>
      </div>

      <div className="grid">
        <Section title="出勤日数" icon="📅">
          <Field label="月の希望出勤日数" priority={P.monthlyDays} hint="空欄（指定なし）にすると、ほかの条件だけで決めます">
            <Stepper value={draft.monthlyDays} onChange={(v) => patch({ monthlyDays: v })} max={total} unit="日" allowEmpty />
            {fieldIssues('monthlyDays')}
          </Field>
          <Field label="週の希望出勤日数" priority={P.weeklyDays}>
            <Stepper value={draft.weeklyDays} onChange={(v) => patch({ weeklyDays: v })} max={7} unit="日" allowEmpty />
            {fieldIssues('weeklyDays')}
          </Field>
          <Field label="土日祝の希望出勤回数" priority={P.weekendHolidayDays} hint="祝日は日本の祝日で判定します（自動作成のときに使います）">
            <Stepper value={draft.weekendHolidayDays} onChange={(v) => patch({ weekendHolidayDays: v })} max={total} unit="回" allowEmpty />
            {fieldIssues('weekendHolidayDays')}
          </Field>
        </Section>

        <Section title="連勤・連休" icon="🔁">
          <Field label="連勤の最大日数" priority={P.maxConsecutiveDays} hint="これより長く続けて出勤することはありません">
            <Stepper value={draft.maxConsecutiveDays} onChange={(v) => patch({ maxConsecutiveDays: v ?? 1 })} min={1} max={31} unit="日まで" />
            {fieldIssues('maxConsecutiveDays')}
          </Field>
          <Field label="連休の希望" priority={P.consecutiveOff}>
            <Toggle
              checked={draft.consecutiveOff.enabled}
              onChange={(v) => patch({ consecutiveOff: { ...draft.consecutiveOff, enabled: v } })}
              label="連休がほしい"
            />
            {draft.consecutiveOff.enabled && (
              <div className="inline-fields">
                <Stepper
                  value={draft.consecutiveOff.length}
                  onChange={(v) => patch({ consecutiveOff: { ...draft.consecutiveOff, length: v ?? 2 } })}
                  min={2}
                  max={14}
                  unit="連休を"
                />
                <Stepper
                  value={draft.consecutiveOff.times}
                  onChange={(v) => patch({ consecutiveOff: { ...draft.consecutiveOff, times: v ?? 1 } })}
                  min={1}
                  max={10}
                  unit="回"
                />
              </div>
            )}
            {fieldIssues('consecutiveOff')}
          </Field>
        </Section>

        <Section title="曜日" icon="🗓️">
          <Field label="出勤可能な曜日" priority={P.availableWeekdays} hint="オフにした曜日は出勤しません">
            <div className="weekday-toggles">
              {WEEK_ORDER.map((wd) => (
                <button
                  key={wd}
                  type="button"
                  className={`weekday-btn wd-${wd} ${draft.availableWeekdays[wd] ? 'on' : ''}`}
                  aria-pressed={draft.availableWeekdays[wd]}
                  onClick={() => {
                    const next = [...draft.availableWeekdays] as MonthConditions['availableWeekdays'];
                    next[wd] = !next[wd];
                    patch({ availableWeekdays: next });
                  }}
                >
                  {WEEKDAY_LABELS[wd]}
                </button>
              ))}
            </div>
            {fieldIssues('availableWeekdays')}
          </Field>
          <Field label="曜日ごとの出勤優先度" priority={P.weekdayPriorities} hint="「ぜひ」の曜日ほど優先して出勤日にします">
            <div className="weekday-priorities">
              {WEEK_ORDER.map((wd) => (
                <div key={wd} className={`wp-row ${draft.availableWeekdays[wd] ? '' : 'disabled'}`}>
                  <span className={`wp-label wd-${wd}`}>{WEEKDAY_LABELS[wd]}</span>
                  <div className="segmented">
                    {PRIORITY_LEVELS.map((label, level) => (
                      <button
                        key={level}
                        type="button"
                        disabled={!draft.availableWeekdays[wd]}
                        className={draft.weekdayPriorities[wd] === level ? 'active' : ''}
                        onClick={() => {
                          const next = [...draft.weekdayPriorities] as MonthConditions['weekdayPriorities'];
                          next[wd] = level;
                          patch({ weekdayPriorities: next });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Field>
        </Section>

        <Section title="勤務時間・勤務区分" icon="⏰">
          <Field label="勤務できる時間帯" priority={P.workHours} hint="この時間帯からはみ出す勤務は入れません">
            <div className="inline-fields time-range">
              <input type="time" value={draft.workStart} onChange={(e) => patch({ workStart: e.target.value })} aria-label="勤務開始時間" />
              <span>〜</span>
              <input type="time" value={draft.workEnd} onChange={(e) => patch({ workEnd: e.target.value })} aria-label="勤務終了時間" />
            </div>
            {fieldIssues('workHours')}
          </Field>
          <Field label="1日の希望勤務時間" priority={P.preferredHours}>
            <Stepper value={draft.preferredHoursPerDay} onChange={(v) => patch({ preferredHoursPerDay: v })} min={0.5} max={24} step={0.5} unit="時間" allowEmpty />
            {fieldIssues('preferredHoursPerDay')}
          </Field>
          <Field label="勤務区分（早番・遅番など）">
            <ShiftTypeEditor value={draft.shiftTypes} onChange={(v) => patch({ shiftTypes: v })} />
            {fieldIssues('shiftTypes')}
          </Field>
        </Section>
      </div>

      <Section title="日付ごとの指定（休み希望・勤務できない日・勤務希望）" icon="📌">
        <DayMarkCalendar month={month} marks={draft.dayMarks} shiftTypes={draft.shiftTypes} onChange={(v) => patch({ dayMarks: v })} />
        {fieldIssues('dayMarks')}
      </Section>

      <Section title="占いの運気" icon="🔮">
        <Field label="運気ごとの希望" priority={P.fortune} hint="「取り込み」タブで占い本の月間カレンダーのページを写真で取り込むと、ここに運気の名前が並びます">
          {fortuneLabels(draft).length === 0 ? (
            <p className="muted">この月の運気はまだ登録されていません。</p>
          ) : (
            <div className="fortune-prefs">
              {fortuneLabels(draft).map(({ label, days }) => {
                const pref = draft.fortunePrefs?.[label] ?? 0;
                return (
                  <div key={label} className="wp-row">
                    <span className="fortune-label">
                      {label}
                      <small className="muted">{days}日</small>
                    </span>
                    <div className="segmented three">
                      {([
                        [-1, '休みたい'],
                        [0, 'どちらでも'],
                        [1, '出勤したい'],
                      ] as const).map(([v, text]) => (
                        <button
                          key={v}
                          type="button"
                          className={pref === v ? 'active' : ''}
                          aria-pressed={pref === v}
                          onClick={() => patch({ fortunePrefs: { ...(draft.fortunePrefs ?? {}), [label]: v } })}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(draft.fortunes?.length ?? 0) > 0 && (
            <details className="fortune-days">
              <summary>日ごとの運気を見る（{draft.fortunes!.length}日）</summary>
              <ul>
                {draft.fortunes!.map((f) => (
                  <li key={f.date}>
                    {formatDate(f.date)}：{f.label}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-ghost" onClick={() => patch({ fortunes: [] })}>
                この月の運気をすべて消す
              </button>
            </details>
          )}
        </Field>
      </Section>

      <Section title="メモ" icon="📝">
        <textarea className="memo" rows={3} placeholder="この月の予定や気をつけたいことなど" value={draft.memo} onChange={(e) => patch({ memo: e.target.value })} />
      </Section>

      <div className={`save-bar ${dirty || message ? 'visible' : ''}`}>
        {message ? (
          <span className="save-ok">✅ {message}</span>
        ) : (
          <>
            <span className="save-status">
              {errors.length > 0 ? `⛔ 入力エラーが ${errors.length} 件あります。直すと保存できます` : '保存していない変更があります'}
            </span>
            <button type="button" className="btn btn-ghost" onClick={discard}>
              元に戻す
            </button>
            <button type="button" className="btn btn-primary" disabled={errors.length > 0} onClick={save}>
              保存する
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 変更があるかどうかを比べるとき、更新日時は無視する */
function stripTime(c: MonthConditions) {
  const { updatedAt: _ignored, ...rest } = c;
  return rest;
}
