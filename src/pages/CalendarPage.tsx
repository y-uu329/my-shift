// カレンダー画面：保存したシフトの表示と手動編集（変更はすぐに自動保存）
import { useEffect, useMemo, useRef, useState } from 'react';
import { DayEditor } from '../components/DayEditor';
import { ShiftCalendar } from '../components/ShiftCalendar';
import { PriorityBadge, Section } from '../components/ui';
import { createDefaultConditions } from '../domain/conditions';
import { addMonths, formatYearMonth } from '../domain/date';
import { createEmptyShift, normalizeDays, updateDay } from '../domain/editing';
import { computeStats, evaluateDays, formatPercent } from '../domain/generator';
import type { DayAssignment, MonthConditions, MonthShift, YearMonth } from '../domain/types';
import { hm, monthPay, yen } from '../domain/pay';
import { useSettings } from '../settingsContext';
import { loadConditions, loadShift, saveShift, trailingWorkStreak, updateShift } from '../storage/repository';

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: string } | { status: 'error' };

export function CalendarPage({ month, onGoGenerate }: { month: YearMonth; onGoGenerate: () => void }) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [conditions, setConditions] = useState<MonthConditions | undefined>();
  const [shift, setShift] = useState<MonthShift | undefined>();
  const [prevStreak, setPrevStreak] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<DayAssignment[][]>([]);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  // 保存を順番どおりに行うための待ち行列
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setUndoStack([]);
    setSave({ status: 'idle' });
    Promise.all([loadConditions(month), loadShift(month), loadShift(addMonths(month, -1))]).then(([c, s, prev]) => {
      if (cancelled) return;
      setConditions(c);
      setShift(s ? { ...s, days: normalizeDays(month, s.days) } : undefined);
      setPrevStreak(trailingWorkStreak(prev));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  // iPad縦・スマホでは編集パネルが下から出るので、選んだ日がパネルに隠れないよう上へスクロールする
  useEffect(() => {
    if (!selected || window.innerWidth > 1000) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.shift-cell.is-selected')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [selected]);

  // 条件がない月でも表示できるよう、初期の条件（勤務区分など）を使う
  const view = conditions ?? createDefaultConditions(month);
  const evaluation = useMemo(() => (shift && conditions ? evaluateDays({ conditions, prevStreak }, shift.days) : null), [shift, conditions, prevStreak]);
  const stats = useMemo(() => (shift ? computeStats(view, shift.days) : null), [shift, view]);

  const persist = (next: MonthShift) => {
    setSave({ status: 'saving' });
    queue.current = queue.current
      .then(() => updateShift(next))
      .then((saved) => setSave({ status: 'saved', at: saved.updatedAt }))
      .catch(() => setSave({ status: 'error' }));
  };

  const changeDays = (days: DayAssignment[]) => {
    if (!shift) return;
    setUndoStack((st) => [...st.slice(-49), shift.days]);
    const next = { ...shift, days };
    setShift(next);
    persist(next);
  };

  const undo = () => {
    if (!shift || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((st) => st.slice(0, -1));
    const next = { ...shift, days: previous };
    setShift(next);
    persist(next);
  };

  const startManual = async () => {
    const created = await saveShift(createEmptyShift(month));
    setShift(created);
    setSave({ status: 'saved', at: created.updatedAt });
  };

  if (loading) return <p className="muted center">読み込み中…</p>;

  if (!shift) {
    return (
      <div className="card empty">
        <h2>{formatYearMonth(month)}のシフトはまだありません</h2>
        <p className="muted">自動作成で作るか、すべて休みの状態から手で入力できます。</p>
        <div className="empty-actions">
          <button type="button" className="btn btn-primary" onClick={onGoGenerate}>
            ✨ 自動作成で作る
          </button>
          <button type="button" className="btn btn-ghost" onClick={startManual}>
            手動で作る
          </button>
        </div>
        {!conditions && <p className="field-hint">※ 勤務条件が未登録のため、勤務区分は初期値（早番・遅番）を使います。</p>}
      </div>
    );
  }

  const index = selected ? shift.days.findIndex((d) => d.date === selected) : -1;
  const day = index >= 0 ? shift.days[index] : null;

  return (
    <div className="calendar-page">
      <div className="toolbar">
        <p className="save-indicator" role="status" aria-live="polite">
          {save.status === 'saving' && '保存中…'}
          {save.status === 'saved' && `✓ 自動保存しました（${new Date(save.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）`}
          {save.status === 'error' && '⛔ 保存できませんでした。もう一度変更してください'}
          {save.status === 'idle' && `${shift.patternName ?? 'シフト'}・最終保存 ${new Date(shift.updatedAt).toLocaleString('ja-JP')}`}
        </p>
        <button type="button" className="btn btn-ghost" onClick={undo} disabled={undoStack.length === 0}>
          ↩︎ 元に戻す{undoStack.length > 0 ? `（${undoStack.length}）` : ''}
        </button>
      </div>

      <div className={`calendar-layout ${day ? 'editing' : ''}`}>
        <div className="calendar-main card">
          <ShiftCalendar conditions={view} days={shift.days} onTapDay={(d) => setSelected(d === selected ? null : d)} selectedDate={selected ?? undefined} large />
          <div className="legend">
            <span className="legend-item"><i className="dot work-dot" />出勤（勤務区分の色）</span>
            <span className="legend-item"><i className="dot off-dot" />休み</span>
            <span className="legend-item"><i className="dot mark-off-request" />休み希望</span>
            <span className="legend-item"><i className="dot mark-unavailable" />勤務できない日・予定</span>
            <span className="legend-item">🔒 確定</span>
            {(view.fortunes?.length ?? 0) > 0 && (
              <span className="legend-item">
                <span className="fortune-chip pref-1">🔮運気</span>出勤したい
                <span className="fortune-chip pref--1">🔮運気</span>休みたい
              </span>
            )}
          </div>
          <p className="field-hint">日付をタップすると、その日を編集できます。変更はすぐに自動保存されます。</p>
        </div>

        {day && (
          <aside className="calendar-side">
            <DayEditor
              day={day}
              conditions={view}
              onChange={(next) => changeDays(updateDay(shift.days, day.date, next))}
              onPrev={index > 0 ? () => setSelected(shift.days[index - 1].date) : undefined}
              onNext={index < shift.days.length - 1 ? () => setSelected(shift.days[index + 1].date) : undefined}
              onClose={() => setSelected(null)}
            />
          </aside>
        )}
      </div>

      {stats && (
        <Section title="この月の集計" icon="🧮">
          <div className="stat-chips">
            <span className="chip">出勤 {stats.workDays}日</span>
            <span className="chip">休み {stats.offDays}日</span>
            <span className="chip">拘束 {stats.totalHours}時間</span>
            {(() => {
              const mp = monthPay(shift.days, settings.pay);
              return (
                <>
                  <span className="chip">休憩 {hm(mp.breakHours)}</span>
                  <span className="chip">実働 {hm(mp.workHours)}</span>
                  <span className="chip pay-chip">💴 見込み {yen(mp.pay)}</span>
                </>
              );
            })()}
            <span className="chip">土日祝の出勤 {stats.weekendHolidayWork}回</span>
            <span className="chip">最大 {stats.maxStreak}連勤</span>
            {stats.byShiftType.map((s) => (
              <span key={s.name} className="chip">
                <i className="dot" style={{ background: s.color }} /> {s.name} {s.count}回
              </span>
            ))}
          </div>
        </Section>
      )}

      {evaluation && (
        <Section title="条件との照らし合わせ（編集後の状態）" icon="📊">
          {evaluation.hard.some((h) => !h.ok) && (
            <div className="alert-inline">
              <strong>⛔ 絶対に守る条件（A）に合っていない日があります</strong>
              <ul>
                {evaluation.hard.filter((h) => !h.ok).map((h) => (
                  <li key={h.label}>
                    {h.label}：{h.detail}
                  </li>
                ))}
              </ul>
              <p className="field-hint">手動の変更はそのまま保存されています。必要なら日付をタップして直してください。</p>
            </div>
          )}
          <p className="eval-summary">
            総合達成度 <strong>{formatPercent(evaluation.summary.overall)}</strong>
            <span className="muted">
              （B {evaluation.summary.b === null ? '－' : formatPercent(evaluation.summary.b)} ／ C {evaluation.summary.c === null ? '－' : formatPercent(evaluation.summary.c)}・達成 {evaluation.summary.met}/{evaluation.summary.total}項目）
            </span>
          </p>
          <ul className="miss-list compact">
            {evaluation.items
              .filter((i) => !i.met)
              .map((item) => (
                <li key={item.key}>
                  <div className="miss-head">
                    <PriorityBadge priority={item.priority} />
                    <strong>{item.label}</strong>
                    <span className="muted">
                      希望 {item.targetText} → {item.actualText}（{formatPercent(item.rate)}）
                    </span>
                  </div>
                  {item.misses.length > 0 && (
                    <ul>
                      {item.misses.map((m, i) => (
                        <li key={i}>{m.text}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
          </ul>
          {evaluation.items.every((i) => i.met) && <p className="ok-text">🎉 すべての希望条件を満たしています</p>}
        </Section>
      )}
      {!conditions && <p className="field-hint">※ 勤務条件が未登録のため、条件との照らし合わせは表示していません。</p>}
    </div>
  );
}
