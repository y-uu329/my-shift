// 写真・スクリーンショットの取り込み画面
// ① 画像の種類を選ぶ → ② 写真を選ぶ（複数可）→ ③ 読み取り → ④ 一覧で確認・修正 → ⑤ 登録
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Section } from '../components/ui';
import { copyConditionsToMonth, createDefaultConditions } from '../domain/conditions';
import { formatDate, formatYearMonth, WEEKDAY_LABELS, weekdayOf } from '../domain/date';
import {
  ACTIONS_FOR_KIND,
  applyRows,
  batchDuplicates,
  blockingIssues,
  existingConflict,
  IMPORT_KIND_LABEL,
  isRealDate,
  monthOf,
  monthWarning,
  ROW_ACTION_LABEL,
  toRows,
  type ImportKind,
  type ImportRow,
  type MonthData,
  type ReadResult,
} from '../domain/importing';
import { VISION_MODELS } from '../domain/settings';
import type { MonthConditions, YearMonth } from '../domain/types';
import { prepareImage } from '../lib/image';
import { useSettings } from '../settingsContext';
import { findLatestConditionsBefore, loadApiKey, loadConditions, loadShift, saveConditions, saveShift } from '../storage/repository';

const KINDS: { kind: ImportKind; icon: string; desc: string }[] = [
  { kind: 'wish', icon: '📝', desc: '出勤できる日・休み希望日・勤務できる時間 → 勤務条件の「日付ごとの指定」に登録' },
  { kind: 'shift', icon: '📋', desc: '確定している勤務日・勤務時間・休み → カレンダーに🔒確定として登録' },
  { kind: 'calendar', icon: '🗓️', desc: '予定がある日・時間 → 「勤務できない日・予定」として登録' },
  { kind: 'fortune', icon: '🔮', desc: '占い本の月間カレンダーのページ → 日ごとの運気を登録（勤務条件で運気ごとの希望を設定）' },
];

interface Picked {
  id: string;
  name: string;
  preview: string;
  data: string;
  status: 'waiting' | 'reading' | 'done' | 'error';
  error?: string;
  result?: ReadResult;
}

export function ImportPage({ month, onGoSettings, onGoConditions, onGoCalendar }: { month: YearMonth; onGoSettings: () => void; onGoConditions: () => void; onGoCalendar: () => void }) {
  const { settings } = useSettings();
  const [apiKey, setApiKey] = useState<string | undefined>();
  const [kind, setKind] = useState<ImportKind>('shift');
  const [personName, setPersonName] = useState('');
  const [images, setImages] = useState<Picked[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [data, setData] = useState<Map<YearMonth, MonthData>>(new Map());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApiKey().then(setApiKey);
    try {
      setPersonName(localStorage.getItem('import-person-name') ?? '');
    } catch {
      /* 保存できない環境では毎回入力 */
    }
  }, []);

  // 読み取った行の日付に合わせて、登録先の月のデータを読み込む（重複チェック用）
  const months = useMemo(() => [...new Set(rows.filter((r) => isRealDate(r.date)).map((r) => monthOf(r.date as string)))].sort(), [rows]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(months.map(async (m) => [m, { conditions: await loadConditions(m), shift: await loadShift(m) }] as const)).then((entries) => {
      if (!cancelled) setData(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [months.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const added: Picked[] = [];
    for (const f of Array.from(files)) {
      try {
        const img = await prepareImage(f);
        added.push({ id: `${Date.now()}-${Math.random()}`, name: f.name, preview: img.preview, data: img.data, status: 'waiting' });
      } catch {
        setError(`「${f.name}」は画像として開けませんでした（JPEG・PNG・スクリーンショットに対応しています）`);
      }
    }
    setImages((cur) => [...cur, ...added]);
  };

  const label = (index: number) => `${index + 1}枚目`;

  const readAll = async () => {
    if (!apiKey) return;
    try {
      localStorage.setItem('import-person-name', personName);
    } catch {
      /* 無視 */
    }
    setBusy(true);
    setDone(null);
    const targets = images.map((img, i) => ({ img, i })).filter(({ img }) => img.status !== 'done');
    for (const { img, i } of targets) {
      setImages((cur) => cur.map((x) => (x.id === img.id ? { ...x, status: 'reading', error: undefined } : x)));
      try {
        // 読み取りの部品（Claude の SDK）は大きいので、使うときだけ読み込む
        const { readImage } = await import('../lib/vision');
        const result = await readImage({ apiKey, model: settings.visionModel, kind, month, personName: personName.trim(), image: { data: img.data, mediaType: 'image/jpeg' } });
        setImages((cur) => cur.map((x) => (x.id === img.id ? { ...x, status: 'done', result } : x)));
        setRows((cur) => [...cur, ...toRows(kind, result, label(i))].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')));
      } catch (e) {
        const msg = e instanceof Error && e.name === 'VisionError' ? e.message : `読み取りに失敗しました（${e instanceof Error ? e.message : '不明なエラー'}）`;
        setImages((cur) => cur.map((x) => (x.id === img.id ? { ...x, status: 'error', error: msg } : x)));
        if (msg.includes('APIキー')) break;
      }
    }
    setBusy(false);
  };

  const updateRow = (id: string, patch: Partial<ImportRow>) => setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const register = async () => {
    setBusy(true);
    try {
      // 条件がない月は、前の月の「いつもの設定」をコピーして作る
      const fresh = new Map<YearMonth, MonthConditions>();
      for (const m of months) {
        if (data.get(m)?.conditions) continue;
        const prev = await findLatestConditionsBefore(m);
        fresh.set(m, prev ? copyConditionsToMonth(prev, m) : createDefaultConditions(m));
      }
      const res = applyRows(rows, data, (m) => fresh.get(m) ?? createDefaultConditions(m));
      for (const [, upd] of res.updates) {
        if (upd.conditions) await saveConditions(upd.conditions);
        if (upd.shift) await saveShift({ ...upd.shift, patternName: upd.shift.patternName ?? '写真から取り込み' });
      }
      const parts = [];
      if (res.marks) parts.push(`休み希望・予定などを${res.marks}件`);
      if (res.shiftDays) parts.push(`確定シフトを${res.shiftDays}日分`);
      if (res.fortunes) parts.push(`運気を${res.fortunes}日分`);
      setDone(`${parts.join('、')}登録しました${res.kept ? `（${res.kept}件は今のままにしました）` : ''}`);
      setRows([]);
      setImages([]);
    } finally {
      setBusy(false);
    }
  };

  const dup = batchDuplicates(rows);
  const issues = rows.length ? blockingIssues(rows, data) : [];
  const warnMonth = monthWarning(rows, month);
  const model = VISION_MODELS.find((m) => m.id === settings.visionModel)!;
  const waiting = images.filter((i) => i.status !== 'done').length;

  if (done) {
    return (
      <div className="card empty">
        <h2>✅ {done}</h2>
        <p className="muted">{kind === 'fortune' ? '勤務条件の「占いの運気」で、運気ごとに「出勤したい／休みたい」を決めると、自動作成に反映されます。' : '登録した内容は、いつでも勤務条件・カレンダーで直せます。'}</p>
        <div className="empty-actions">
          <button type="button" className="btn btn-primary" onClick={kind === 'shift' ? onGoCalendar : onGoConditions}>
            {kind === 'shift' ? '📅 カレンダーで確認する' : kind === 'fortune' ? '🔮 運気ごとの希望を設定する' : '📝 勤務条件で確認する'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDone(null)}>
            続けて取り込む
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import-page">
      {!apiKey && (
        <div className="notice">
          <p>
            📷 写真の読み取りには Claude の APIキーが必要です。<button type="button" className="link-btn" onClick={onGoSettings}>設定画面</button>でキーを登録してください（作り方・料金も設定画面に書いてあります）。
          </p>
        </div>
      )}

      <Section title="1. 取り込む画像の種類" icon="🖼️">
        <div className="kind-cards" role="radiogroup">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className={`kind-card ${kind === k.kind ? 'active' : ''}`} onClick={() => setKind(k.kind)} disabled={rows.length > 0}>
              <span className="kind-icon" aria-hidden>
                {k.icon}
              </span>
              <strong>{IMPORT_KIND_LABEL[k.kind]}</strong>
              <small>{k.desc}</small>
            </button>
          ))}
        </div>
        {kind === 'shift' && (
          <div className="field">
            <label className="field-label" htmlFor="person-name">
              シフト表に載っているあなたの名前（複数人の表のとき）
            </label>
            <input id="person-name" type="text" value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="例：山田" />
          </div>
        )}
        {rows.length > 0 && <p className="field-hint">種類を変えるには、下の一覧を「やり直す」で消してください。</p>}
      </Section>

      <Section title="2. 写真・スクリーンショットを選ぶ（複数可）" icon="📷">
        <label className="file-drop">
          <input type="file" accept="image/*" multiple onChange={(e) => { pick(e.target.files); e.target.value = ''; }} disabled={busy} />
          <span>＋ 写真を選ぶ</span>
          <small>iPad・iPhone では写真アプリから選べます</small>
        </label>
        {error && <p className="issue issue-error">⛔ {error}</p>}
        {images.length > 0 && (
          <ul className="thumbs">
            {images.map((img, i) => (
              <li key={img.id} className={`thumb status-${img.status}`}>
                <img src={img.preview} alt={`${label(i)}：${img.name}`} />
                <div className="thumb-info">
                  <strong>{label(i)}</strong>
                  <span className="thumb-status">
                    {img.status === 'waiting' && '読み取り前'}
                    {img.status === 'reading' && '読み取り中…'}
                    {img.status === 'done' && `✓ ${img.result?.entries.length ?? 0}件 読み取り`}
                    {img.status === 'error' && `⛔ ${img.error}`}
                  </span>
                  {img.result && img.result.unreadable.length > 0 && (
                    <details>
                      <summary>⚠️ 読み取れなかった部分（{img.result.unreadable.length}）</summary>
                      <ul>
                        {img.result.unreadable.map((u, k) => (
                          <li key={k}>
                            「{u.text}」：{u.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {img.status !== 'reading' && (
                  <button type="button" className="icon-btn" aria-label={`${label(i)}を外す`} onClick={() => setImages((cur) => cur.filter((x) => x.id !== img.id))} disabled={busy}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="read-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={readAll} disabled={!apiKey || busy || waiting === 0}>
            {busy ? '読み取り中…' : `🔍 ${waiting}枚を読み取る`}
          </button>
          <span className="field-hint">
            {model.name}・{model.note}。画像は読み取りのために Anthropic に送られます。
          </span>
        </div>
      </Section>

      {rows.length > 0 && (
        <Section title="3. 読み取り結果を確認・修正して登録" icon="✅">
          <p className="field-hint">⚠️ の行は、読み取りに失敗した・自信がない部分です。元の画像と見比べて直してください。チェックを外した行は登録しません。</p>
          {warnMonth && <p className="notice">ℹ️ {warnMonth}</p>}
          <div className="table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>登録</th>
                  <th>日付</th>
                  <th>内容</th>
                  <th>時間</th>
                  <th>メモ</th>
                  <th>元の画像</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const conflict = r.include ? existingConflict(r, data.get(r.date ? monthOf(r.date) : '')) : null;
                  const dupWith = dup.get(r.id);
                  const hasNotes = !!(r.warning || conflict || (dupWith && r.include));
                  return (
                    <Fragment key={r.id}>
                    <tr className={`${r.warning ? 'has-warning' : ''} ${!r.include ? 'excluded' : ''} ${hasNotes ? 'with-notes' : ''}`}>
                      <td data-label="登録">
                        <input type="checkbox" checked={r.include} onChange={(e) => updateRow(r.id, { include: e.target.checked })} aria-label="この行を登録する" />
                      </td>
                      <td data-label="日付">
                        <input type="date" value={r.date} onChange={(e) => updateRow(r.id, { date: e.target.value, resolution: 'unset' })} aria-label="日付" />
                        <span className="muted">{isRealDate(r.date) ? `(${WEEKDAY_LABELS[weekdayOf(r.date)]})` : ''}</span>
                      </td>
                      <td data-label="内容">
                        <select value={r.action} onChange={(e) => updateRow(r.id, { action: e.target.value as ImportRow['action'], resolution: 'unset' })} aria-label="内容">
                          {ACTIONS_FOR_KIND[kind].map((a) => (
                            <option key={a} value={a}>
                              {ROW_ACTION_LABEL[a]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="時間">
                        {r.action === 'shift-work' ? (
                          <span className="time-pair">
                            <input type="time" value={r.start} onChange={(e) => updateRow(r.id, { start: e.target.value, resolution: 'unset' })} aria-label="開始" />
                            〜
                            <input type="time" value={r.end} onChange={(e) => updateRow(r.id, { end: e.target.value, resolution: 'unset' })} aria-label="終了" />
                          </span>
                        ) : (
                          <span className="muted">{r.action === 'shift-off' ? '休み' : r.action === 'fortune' ? '—' : '（メモに記録）'}</span>
                        )}
                      </td>
                      <td data-label="メモ">
                        <input type="text" value={r.note} onChange={(e) => updateRow(r.id, { note: e.target.value, resolution: 'unset' })} aria-label={r.action === 'fortune' ? '運気の名前' : 'メモ'} placeholder={r.action === 'fortune' ? '例：開運' : ''} />
                      </td>
                      <td data-label="元の画像" className="muted">
                        {r.source}
                      </td>
                    </tr>
                      {hasNotes && (
                        <tr className={`notes-row ${!r.include ? 'excluded' : ''}`}>
                        <td className="row-notes" colSpan={6}>
                          {r.warning && <p className="issue issue-warning">⚠️ {r.warning}</p>}
                          {dupWith && r.include && <p className="issue issue-error">⛔ {dupWith.join('・')}にも同じ日付（{formatDate(r.date as string)}）があります。どちらか一方のチェックを外してください</p>}
                          {conflict && (
                            <div className="conflict" role="radiogroup" aria-label="登録済みの内容と重なっています">
                              <p className="issue issue-warning">🔁 {conflict}</p>
                              <label>
                                <input type="radio" name={`res-${r.id}`} checked={r.resolution === 'replace'} onChange={() => updateRow(r.id, { resolution: 'replace' })} /> 新しい内容にする
                              </label>
                              <label>
                                <input type="radio" name={`res-${r.id}`} checked={r.resolution === 'keep'} onChange={() => updateRow(r.id, { resolution: 'keep' })} /> 今のままにする
                              </label>
                            </div>
                          )}
                        </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {issues.length > 0 && (
            <ul className="blocking">
              {issues.map((i) => (
                <li key={i}>⛔ {i}</li>
              ))}
            </ul>
          )}
          <div className="register-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setRows([]); setImages([]); }} disabled={busy}>
              やり直す
            </button>
            <button type="button" className="btn btn-primary btn-lg" onClick={register} disabled={busy || issues.length > 0}>
              {rows.filter((r) => r.include).length}件を登録する
            </button>
          </div>
          <p className="field-hint">登録先：{months.map(formatYearMonth).join('、') || '—'}</p>
        </Section>
      )}
    </div>
  );
}
