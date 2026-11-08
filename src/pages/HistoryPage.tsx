// 履歴・出力の画面：PDF／画像／CSVの出力、この月の過去の版、保存しているシフトの一覧
import { useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../components/ConfirmDialog';
import { ShiftCalendar } from '../components/ShiftCalendar';
import { Section } from '../components/ui';
import { createDefaultConditions } from '../domain/conditions';
import { formatYearMonth } from '../domain/date';
import { normalizeDays } from '../domain/editing';
import { buildCsv, exportFileName, pdfFromJpeg } from '../domain/export';
import { computeStats, diffDays } from '../domain/generator';
import type { MonthConditions, MonthShift, YearMonth } from '../domain/types';
import { canvasToBlob, renderShiftCanvas } from '../lib/renderImage';
import { saveFile } from '../lib/saveFile';
import { monthPay, yen } from '../domain/pay';
import { useSettings } from '../settingsContext';
import { listShiftMonths, loadConditions, loadShift, loadShiftHistory, restoreFromHistory } from '../storage/repository';

const fmt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function HistoryPage({ month, onSelectMonth, onGoCalendar }: { month: YearMonth; onSelectMonth: (m: YearMonth) => void; onGoCalendar: () => void }) {
  const { settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [conditions, setConditions] = useState<MonthConditions | undefined>();
  const [shift, setShift] = useState<MonthShift | undefined>();
  const [history, setHistory] = useState<MonthShift[]>([]);
  const [months, setMonths] = useState<YearMonth[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [c, s, h, ms] = await Promise.all([loadConditions(month), loadShift(month), loadShiftHistory(month), listShiftMonths()]);
    setConditions(c);
    setShift(s ? { ...s, days: normalizeDays(month, s.days) } : undefined);
    setHistory(h.map((x) => ({ ...x, days: normalizeDays(month, x.days) })));
    setMonths(ms);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOpen(null);
    setMessage(null);
    reload().then(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const view = useMemo(() => conditions ?? createDefaultConditions(month), [conditions, month]);

  // 出力する画像のプレビュー
  useEffect(() => {
    if (!shift) {
      setPreview(null);
      return;
    }
    try {
      setPreview(renderShiftCanvas(shift, view, settings.pay).toDataURL('image/png'));
    } catch {
      setPreview(null);
    }
  }, [shift, view, settings.pay]);

  const run = async (kind: 'png' | 'pdf' | 'csv') => {
    if (!shift) return;
    setBusy(true);
    setMessage(null);
    try {
      let blob: Blob;
      if (kind === 'csv') blob = new Blob([buildCsv(shift, conditions, settings.pay)], { type: 'text/csv;charset=utf-8' });
      else {
        const canvas = renderShiftCanvas(shift, view, settings.pay);
        if (kind === 'png') blob = await canvasToBlob(canvas, 'image/png');
        else {
          const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
          blob = new Blob([pdfFromJpeg(jpeg, canvas.width, canvas.height) as BlobPart], { type: 'application/pdf' });
        }
      }
      const result = await saveFile(blob, exportFileName(shift, kind));
      if (result === 'downloaded') setMessage(`「${exportFileName(shift, kind)}」を保存しました（ダウンロード）`);
      else if (result === 'shared') setMessage('共有メニューから保存しました');
    } catch (e) {
      setMessage(`⛔ 出力できませんでした：${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (index: number) => {
    const target = history[index];
    if (!(await confirmDialog(`${fmt(target.updatedAt)} に保存した版（${target.patternName ?? '手動'}）に戻します。今のシフトは履歴に残ります。`, 'この版に戻す'))) return;
    await restoreFromHistory(month, index);
    await reload();
    setOpen(null);
    setMessage('選んだ版に戻しました');
  };

  if (loading) return <p className="muted center">読み込み中…</p>;

  const currentStats = shift ? computeStats(view, shift.days) : null;

  return (
    <div className="history-page">
      {message && (
        <p className="toast" role="status">
          {message.startsWith('⛔') ? message : `✅ ${message}`}
        </p>
      )}

      <Section title={`${formatYearMonth(month)}のシフトを出力`} icon="📤">
        {!shift ? (
          <p className="muted">この月のシフトはまだ保存されていません。「シフト作成」か「カレンダー」で作ると出力できます。</p>
        ) : (
          <div className="export-layout">
            {preview && <img className="export-preview" src={preview} alt={`${formatYearMonth(month)}のシフト表（出力イメージ）`} />}
            <div className="export-actions">
              <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => run('pdf')}>
                📄 PDFで保存
              </button>
              <button type="button" className="btn btn-ghost btn-lg" disabled={busy} onClick={() => run('png')}>
                🖼️ 画像で保存
              </button>
              <button type="button" className="btn btn-ghost btn-lg" disabled={busy} onClick={() => run('csv')}>
                📊 CSVで保存
              </button>
              <p className="field-hint">
                iPad・iPhoneでは共有メニューが開きます。画像は「画像を保存」で写真に、PDF・CSVは「"ファイル"に保存」で保存できます。CSVはExcel・Numbersで開けます。
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section title={`${formatYearMonth(month)}の履歴`} icon="🕘">
        {shift && currentStats && (
          <div className="version current">
            <div className="version-head">
              <span className="version-badge">いまの版</span>
              <strong>{shift.patternName ?? '手動'}</strong>
              <span className="muted">
                {fmt(shift.updatedAt)} ・ 出勤{currentStats.workDays}日 ・ {currentStats.totalHours}時間 ・ 見込み{yen(monthPay(shift.days, settings.pay).pay)}
              </span>
              <button type="button" className="link-btn" onClick={onGoCalendar}>
                カレンダーで開く
              </button>
            </div>
          </div>
        )}
        {history.length === 0 ? (
          <p className="muted">過去の版はまだありません。自動作成で別のパターンを採用したり、版を戻したりすると、前の版がここに残ります。</p>
        ) : (
          <ul className="version-list">
            {history.map((h, i) => {
              const st = computeStats(view, h.days);
              const changed = shift ? diffDays(shift.days, h.days).length : 0;
              return (
                <li key={`${h.updatedAt}-${i}`} className="version">
                  <div className="version-head">
                    <strong>{h.patternName ?? '手動'}</strong>
                    <span className="muted">
                      {fmt(h.updatedAt)} ・ 出勤{st.workDays}日 ・ {st.totalHours}時間 ・ 見込み{yen(monthPay(h.days, settings.pay).pay)}{shift ? ` ・ いまの版と${changed}日ちがう` : ''}
                    </span>
                    <div className="version-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                        {open === i ? '閉じる' : '見る'}
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => restore(i)}>
                        この版に戻す
                      </button>
                    </div>
                  </div>
                  {open === i && (
                    <div className="version-preview">
                      <ShiftCalendar conditions={view} days={h.days} changedDates={shift ? new Set(diffDays(shift.days, h.days)) : undefined} />
                      {shift && <p className="field-hint">● の日は、いまの版とちがう日です。</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="保存しているシフト（月ごと）" icon="🗂️">
        {months.length === 0 ? (
          <p className="muted">まだシフトは保存されていません。</p>
        ) : (
          <div className="month-list">
            {months.map((m) => (
              <button key={m} type="button" className={`month-chip ${m === month ? 'active' : ''}`} onClick={() => onSelectMonth(m)} aria-current={m === month ? 'true' : undefined}>
                {formatYearMonth(m)}
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
