// 給料のページ：今月分のまとめと、締め日で区切った期間ごとの一覧
import { useEffect, useMemo, useState } from 'react';
import { Section } from '../components/ui';
import { currentYearMonth, formatDate, formatYearMonth, toDateStr } from '../domain/date';
import { dayPay, hm, yen } from '../domain/pay';
import { periodMonthOf, periodPay, periodsWithData, type PeriodPay } from '../domain/payPeriods';
import type { DayAssignment, MonthConditions, YearMonth } from '../domain/types';
import { useSettings } from '../settingsContext';
import { listShiftMonths, loadConditions, loadShift } from '../storage/repository';

const CLOSING_OPTIONS = [0, ...Array.from({ length: 28 }, (_, i) => i + 1)];
const closingLabel = (d: number) => (d === 0 ? '末日締め' : `${d}日締め`);
const today = () => {
  const now = new Date();
  return toDateStr(currentYearMonth(now), now.getDate());
};

export function PayPage({ onGoSettings, onGoCalendar }: { onGoSettings: () => void; onGoCalendar: (month: YearMonth) => void }) {
  const { settings, update } = useSettings();
  const closingDay = settings.pay.closingDay ?? 0;
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<Map<YearMonth, DayAssignment[]>>(new Map());
  const [typeNames, setTypeNames] = useState<Map<string, { name: string; color: string }>>(new Map());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const months = await listShiftMonths();
      const map = new Map<YearMonth, DayAssignment[]>();
      const names = new Map<string, { name: string; color: string }>();
      for (const m of months) {
        const [s, c] = await Promise.all([loadShift(m), loadConditions(m)]);
        if (s) map.set(m, s.days);
        (c as MonthConditions | undefined)?.shiftTypes.forEach((t) => names.set(t.id, { name: t.name, color: t.color }));
      }
      if (!cancelled) {
        setShifts(map);
        setTypeNames(names);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = periodMonthOf(today(), closingDay);
  const periods = useMemo(() => {
    const list = periodsWithData([...shifts.keys()], closingDay);
    if (!list.includes(current)) list.push(current);
    return list.sort().reverse().map((m) => periodPay(m, shifts, settings.pay));
  }, [shifts, closingDay, settings.pay, current]);

  if (loading) return <p className="muted center">読み込み中…</p>;

  const now = periods.find((p) => p.month === current)!;
  const withData = periods.filter((p) => p.workDays > 0);
  const total = withData.reduce((s, p) => s + p.pay, 0);
  // 平均は、シフトがすべてそろっている期間だけで計算する（⚠️の期間は少なく出るため）
  const complete = withData.filter((p) => p.missingMonths.length === 0);
  const average = complete.length ? Math.round(complete.reduce((s, p) => s + p.pay, 0) / complete.length) : null;

  return (
    <div className="pay-page">
      <Section title="給料の計算のしかた" icon="⚙️">
        <div className="pay-rule">
          <label className="field-label" htmlFor="closing-day">
            締め日
          </label>
          <select
            id="closing-day"
            value={closingDay}
            onChange={(e) => update({ ...settings, pay: { ...settings.pay, closingDay: Number(e.target.value) } })}
          >
            {CLOSING_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {closingLabel(d)}
              </option>
            ))}
          </select>
          <span className="muted">
            時給 {yen(settings.pay.hourlyWage)}・休憩 {[...settings.pay.breakRules].sort((a, b) => a.overHours - b.overHours).map((r) => `${r.overHours}時間超は${r.minutes}分`).join('、')}
          </span>
          <button type="button" className="link-btn" onClick={onGoSettings}>
            時給・休憩を変える
          </button>
        </div>
        <p className="field-hint">
          {closingDay === 0 ? '「12月分」＝12月1日〜31日のシフトです。' : `「12月分」＝11月${closingDay + 1}日〜12月${closingDay}日のシフトです。`}
          見込み給料＝実働時間の合計×時給（割増・交通費・税金などは含みません）。
        </p>
      </Section>

      <Section title={`今月分のまとめ（${formatYearMonth(now.month)}分）`} icon="💴">
        <p className="period-range">
          {formatDate(now.start)}〜{formatDate(now.end)}
        </p>
        <dl className="pay-summary">
          <div>
            <dt>見込み給料</dt>
            <dd className="pay-total">{yen(now.pay)}</dd>
          </div>
          <div>
            <dt>出勤</dt>
            <dd>{now.workDays}日</dd>
          </div>
          <div>
            <dt>実働</dt>
            <dd>{hm(now.workHours)}</dd>
          </div>
          <div>
            <dt>休憩</dt>
            <dd>{hm(now.breakHours)}</dd>
          </div>
          <div>
            <dt>拘束（開始〜終了）</dt>
            <dd>{hm(now.spanHours)}</dd>
          </div>
        </dl>
        <TypeCounts period={now} names={typeNames} />
        <MissingNote period={now} onGoCalendar={onGoCalendar} />
        {now.workDays > 0 && (
          <details className="pay-days" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
            <summary>日ごとの内訳（{now.workDays}日）</summary>
            <div className="table-wrap">
              <table className="score-table pay-table">
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>勤務</th>
                    <th>休憩</th>
                    <th>実働</th>
                    <th className="num">給料</th>
                  </tr>
                </thead>
                <tbody>
                  {now.days
                    .filter((d) => d.work)
                    .map((d) => {
                      const p = dayPay(d, settings.pay);
                      return (
                        <tr key={d.date}>
                          <td>{formatDate(d.date)}</td>
                          <td>
                            {d.shiftTypeId ? `${typeNames.get(d.shiftTypeId)?.name ?? ''} ` : ''}
                            {d.start}〜{d.end}
                          </td>
                          <td>{p.breakMinutes}分</td>
                          <td>{hm(p.workHours)}</td>
                          <td className="num">{yen(p.pay)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Section>

      <Section title={`期間ごとの一覧（${closingLabel(closingDay)}）`} icon="📊">
        <div className="table-wrap">
          <table className="score-table pay-table pay-list">
            <thead>
              <tr>
                <th>〇月分</th>
                <th>期間</th>
                <th className="num">出勤</th>
                <th className="num">実働</th>
                <th className="num">見込み給料</th>
                <th className="num">前の期間との差</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => {
                const prev = periods[i + 1];
                const diff = prev && (p.workDays > 0 || prev.workDays > 0) ? p.pay - prev.pay : null;
                return (
                  <tr key={p.month} className={p.month === current ? 'is-current' : ''}>
                    <td data-label="〇月分">
                      <strong>{formatYearMonth(p.month)}分</strong>
                      {p.month === current && <span className="version-badge">今月</span>}
                      {p.missingMonths.length > 0 && <span className="missing-mark" title="シフトが保存されていない月がかかっています">⚠️</span>}
                    </td>
                    <td data-label="期間" className="muted">
                      {formatDate(p.start)}〜{formatDate(p.end)}
                    </td>
                    <td data-label="出勤" className="num">
                      {p.workDays}日
                    </td>
                    <td data-label="実働" className="num">
                      {hm(p.workHours)}
                    </td>
                    <td data-label="見込み給料" className="num pay-cell">
                      {yen(p.pay)}
                    </td>
                    <td data-label="前の期間との差" className={`num ${diff === null ? '' : diff >= 0 ? 'diff-up' : 'diff-down'}`}>
                      {diff === null ? '－' : `${diff >= 0 ? '+' : '−'}${yen(Math.abs(diff))}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {withData.length > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={4}>シフトがある {withData.length}期間の合計・平均</td>
                  <td className="num pay-cell">
                    {yen(total)}
                    {average !== null && (
                      <small className="muted">
                        平均 {yen(average)}
                        {complete.length < withData.length ? `（⚠️を除く${complete.length}期間）` : ''}
                      </small>
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="field-hint">⚠️ は、期間の中にシフトを保存していない月がある期間です（その日数は0円として計算しています）。シフトを作成・保存すると自動で反映されます。</p>
      </Section>
    </div>
  );
}

function TypeCounts({ period, names }: { period: PeriodPay; names: Map<string, { name: string; color: string }> }) {
  const counts = new Map<string, number>();
  for (const d of period.days) if (d.work) counts.set(d.shiftTypeId ?? '', (counts.get(d.shiftTypeId ?? '') ?? 0) + 1);
  if (counts.size === 0) return null;
  return (
    <div className="stat-chips">
      {[...counts].map(([id, n]) => (
        <span key={id} className="chip">
          {id && names.get(id) ? <i className="dot" style={{ background: names.get(id)!.color }} /> : null} {id ? (names.get(id)?.name ?? '勤務') : '時間指定'} {n}回
        </span>
      ))}
    </div>
  );
}

function MissingNote({ period, onGoCalendar }: { period: PeriodPay; onGoCalendar: (m: YearMonth) => void }) {
  if (period.missingMonths.length === 0) return null;
  return (
    <p className="notice">
      ⚠️ {period.missingMonths.map(formatYearMonth).join('・')}のシフトがまだ保存されていないため、その日数は0円で計算しています。
      {period.missingMonths.map((m) => (
        <button key={m} type="button" className="link-btn" onClick={() => onGoCalendar(m)}>
          {formatYearMonth(m)}のシフトを作る
        </button>
      ))}
    </p>
  );
}
