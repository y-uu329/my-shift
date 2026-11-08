// シフト自動作成の画面
import { useEffect, useState } from 'react';
import { confirmDialog } from '../components/ConfirmDialog';
import { ShiftCalendar } from '../components/ShiftCalendar';
import { PriorityBadge, Section } from '../components/ui';
import { addMonths, formatYearMonth, WEEKDAY_LABELS } from '../domain/date';
import { formatPercent, generateShifts, type GenerateResult, type PatternResult } from '../domain/generator';
import type { MonthConditions, MonthShift, YearMonth } from '../domain/types';
import { monthPay, yen } from '../domain/pay';
import { useSettings } from '../settingsContext';
import { loadConditions, loadShift, saveShift, trailingWorkStreak } from '../storage/repository';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function GeneratePage({ month, onGoConditions, onGoCalendar }: { month: YearMonth; onGoConditions: () => void; onGoCalendar: () => void }) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [conditions, setConditions] = useState<MonthConditions | undefined>();
  const [existing, setExisting] = useState<MonthShift | undefined>();
  const [prevStreak, setPrevStreak] = useState(0);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [adjusted, setAdjusted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setMessage(null);
    Promise.all([loadConditions(month), loadShift(month), loadShift(addMonths(month, -1))]).then(([c, s, prev]) => {
      if (cancelled) return;
      setConditions(c);
      setExisting(s);
      setPrevStreak(trailingWorkStreak(prev));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (loading) return <p className="muted center">読み込み中…</p>;

  if (!conditions) {
    return (
      <div className="card empty">
        <h2>{formatYearMonth(month)}の勤務条件がまだありません</h2>
        <p className="muted">シフトを作るには、先に勤務条件を登録して保存してください。</p>
        <button type="button" className="btn btn-primary" onClick={onGoConditions}>
          勤務条件を登録する
        </button>
      </div>
    );
  }

  /** adjust=true なら、今のシフトをもとに変更を少なく作り直す */
  const run = (adjust: boolean) => {
    setBusy(true);
    setMessage(null);
    setAdjusted(adjust);
    // 「作成中…」を画面に出してから計算を始める
    setTimeout(() => {
      const r = generateShifts({ conditions, prevStreak, baseline: adjust && existing ? existing.days : undefined });
      setResult(r);
      if (r.ok) {
        // いちばん総合達成度が高いパターンを最初に表示
        const best = r.patterns.reduce((bi, p, i, arr) => (p.summary.overall > arr[bi].summary.overall ? i : bi), 0);
        setSelected(best);
      }
      setBusy(false);
    }, 30);
  };

  const adopt = async (p: PatternResult) => {
    if (existing && !(await confirmDialog(`${formatYearMonth(month)}にはすでに保存したシフトがあります。新しいシフトに置き換えますか？（前のシフトは履歴に残ります）`, '置き換える'))) return;
    const now = new Date().toISOString();
    const name = adjusted ? `${p.def.name}（作り直し）` : p.def.name;
    const saved = await saveShift({ version: 1, month, days: p.days, patternName: name, createdAt: now, updatedAt: now });
    setExisting(saved);
    setMessage(`「${name}」のシフトを保存しました（前のシフトは「履歴・出力」に残っています）`);
  };

  return (
    <div className="generate">
      <div className="card gen-hero">
        <div>
          <h2 className="card-title">✨ {formatYearMonth(month)}のシフトを自動作成</h2>
          <p className="muted">
            保存済みの勤務条件から、考え方の違う3つのパターンを作ります。A（絶対に守る）条件は必ず守ります。
          </p>
          {existing && (
            <p className="field-hint">
              📌 保存済みのシフトがあります（{existing.patternName ?? '手動'}・{new Date(existing.updatedAt).toLocaleString('ja-JP')}）。
              条件を変えたときは「今のシフトを活かして作り直す」で、変える日をなるべく少なくできます。🔒確定の日は変えません。採用するまでは置き換わりません。
            </p>
          )}
        </div>
        <div className="gen-actions">
          {existing ? (
            <>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => run(true)} disabled={busy}>
                {busy && adjusted ? '作成中…' : '🔁 今のシフトを活かして作り直す'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => run(false)} disabled={busy}>
                {busy && !adjusted ? '作成中…' : 'ゼロから3パターンを作る'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => run(false)} disabled={busy}>
              {busy ? '作成中…' : result ? 'もう一度作成する' : '3パターンを作成する'}
            </button>
          )}
          <button type="button" className="link-btn" onClick={onGoConditions}>
            勤務条件を確認・変更する
          </button>
        </div>
      </div>

      {message && (
        <div className="toast">
          <span>✅ {message}</span>
          <button type="button" className="btn btn-primary" onClick={onGoCalendar}>
            📅 カレンダーで確認・編集する
          </button>
        </div>
      )}

      {result && !result.ok && (
        <div className="card alert-error">
          <h3>⛔ シフトを作成できませんでした</h3>
          <p>次の理由で、絶対に守る条件（A）を満たすシフトが作れません。勤務条件を見直してください。</p>
          <ul>
            {result.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost" onClick={onGoConditions}>
            勤務条件を直す
          </button>
        </div>
      )}

      {result?.ok && (
        <>
          {result.notices.length > 0 && (
            <div className="notice">
              {result.notices.map((n, i) => (
                <p key={i}>ℹ️ {n}</p>
              ))}
            </div>
          )}

          <div className="pattern-cards" role="tablist" aria-label="パターンの選択">
            {result.patterns.map((p, i) => (
              <button
                key={p.def.id}
                type="button"
                role="tab"
                aria-selected={selected === i}
                className={`pattern-card ${selected === i ? 'active' : ''}`}
                onClick={() => setSelected(i)}
              >
                <span className="pattern-name">
                  {p.def.name}
                  {p.sameAs && <small className="same-as">「{p.sameAs}」と同じ結果</small>}
                </span>
                <span className="pattern-score">{formatPercent(p.summary.overall)}</span>
                <span className="pattern-sub">
                  B {p.summary.b === null ? '－' : formatPercent(p.summary.b)} ／ C {p.summary.c === null ? '－' : formatPercent(p.summary.c)}
                </span>
                <span className="pattern-sub">
                  {p.stats.workDays}日出勤・{p.stats.totalHours}時間・達成 {p.summary.met}/{p.summary.total}項目
                </span>
                <span className="pattern-sub">💴 見込み {yen(monthPay(p.days, settings.pay).pay)}
                </span>
                {p.changes && <span className="pattern-change">今のシフトから {p.changes.length}日 変更</span>}
              </button>
            ))}
          </div>
          <p className="field-hint">
            総合達成度 =（B条件の達成度の平均 × 2 ＋ C条件の達成度の平均 × 1）÷ 3。各条件の達成度は下の表の計算方法で、実際の日数・回数から計算しています。
          </p>

          <PatternDetail pattern={result.patterns[selected]} conditions={conditions} onAdopt={adopt} />
        </>
      )}
    </div>
  );
}

function PatternDetail({ pattern: p, conditions, onAdopt }: { pattern: PatternResult; conditions: MonthConditions; onAdopt: (p: PatternResult) => void }) {
  const missed = p.items.filter((i) => !i.met);
  return (
    <div className="pattern-detail">
      <div className="detail-head">
        <div>
          <h3>{p.def.name}</h3>
          <p className="muted">{p.def.description}</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => onAdopt(p)}>
          このパターンを採用して保存
        </button>
      </div>

      <div className="detail-grid">
        <Section title="カレンダー" icon="📅">
          <ShiftCalendar conditions={conditions} days={p.days} changedDates={p.changes ? new Set(p.changes) : undefined} />
          <p className="field-hint">
            赤い枠の日は、休み希望・勤務希望どおりにならなかった日です。{p.changes && '● の日は、今のシフトから変わる日です。'}
          </p>
        </Section>

        <div>
          <Section title="希望に合わなかったところ" icon="⚠️">
            {missed.length === 0 ? (
              <p className="ok-text">🎉 すべての希望条件を満たしています</p>
            ) : (
              <ul className="miss-list">
                {missed.map((item) => (
                  <li key={item.key}>
                    <div className="miss-head">
                      <PriorityBadge priority={item.priority} />
                      <strong>{item.label}</strong>
                      <span className="muted">（達成度 {formatPercent(item.rate)}）</span>
                    </div>
                    <ul>
                      {item.misses.map((m, i) => (
                        <li key={i}>{m.text}</li>
                      ))}
                    </ul>
                    {item.reason && <p className="reason">理由：{item.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="絶対に守る条件（A）" icon="🛡️">
            <ul className="hard-list">
              {p.hard.map((h) => (
                <li key={h.label} className={h.ok ? 'ok' : 'ng'}>
                  {h.ok ? '✅' : '⛔'} <strong>{h.label}</strong> <span className="muted">{h.detail}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <Section title="条件ごとの達成度" icon="📊">
        <div className="table-wrap">
          <table className="score-table responsive">
            <thead>
              <tr>
                <th>条件</th>
                <th>希望</th>
                <th>結果</th>
                <th>達成度</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((item) => (
                <tr key={item.key}>
                  <td>
                    <PriorityBadge priority={item.priority} /> {item.label}
                  </td>
                  <td data-label="希望">{item.targetText}</td>
                  <td data-label="結果">{item.actualText}</td>
                  <td>
                    <div className="bar" aria-hidden>
                      <span style={{ width: formatPercent(item.rate) }} className={item.met ? 'full' : ''} />
                    </div>
                    <span className="bar-label">{formatPercent(item.rate)}</span>
                    <small className="calc-note">{item.rateNote}</small>
                  </td>
                </tr>
              ))}
              {p.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    B・C の希望条件が設定されていません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="集計" icon="🧮">
        <div className="stat-chips">
          <span className="chip">出勤 {p.stats.workDays}日</span>
          <span className="chip">休み {p.stats.offDays}日</span>
          <span className="chip">合計 {p.stats.totalHours}時間</span>
          <span className="chip">土日祝の出勤 {p.stats.weekendHolidayWork}回</span>
          <span className="chip">最大 {p.stats.maxStreak}連勤</span>
          {p.stats.byShiftType.map((s) => (
            <span key={s.name} className="chip">
              <i className="dot" style={{ background: s.color }} /> {s.name} {s.count}回
            </span>
          ))}
        </div>
        <h4 className="sub-title">曜日ごとの出勤回数</h4>
        <div className="weekday-stats">
          {WEEK_ORDER.map((wd) => (
            <div key={wd} className="weekday-stat">
              <span className={`wd-${wd}`}>{WEEKDAY_LABELS[wd]}</span>
              <strong>{p.stats.byWeekday[wd]}</strong>
            </div>
          ))}
        </div>
        <h4 className="sub-title">週ごとの出勤</h4>
        <div className="table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>週</th>
                <th>出勤日数</th>
                <th>勤務時間</th>
              </tr>
            </thead>
            <tbody>
              {p.stats.weeks.map((w) => (
                <tr key={w.label}>
                  <td>{w.label}</td>
                  <td>{w.days}日</td>
                  <td>{w.hours}時間</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
