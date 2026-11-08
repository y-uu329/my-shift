// 設定画面：給料（時給・休憩）と、写真の読み取り（Claude API）の設定
import { useEffect, useState } from 'react';
import { confirmDialog } from '../components/ConfirmDialog';
import { Field, Section, Stepper } from '../components/ui';
import { DEFAULT_PAY, dayPay, hm, yen, type BreakRule } from '../domain/pay';
import { VISION_MODELS, type AppSettings } from '../domain/settings';
import { useSettings } from '../settingsContext';
import { buildBackup, parseBackup, summarizeBackup } from '../domain/backup';
import { saveFile } from '../lib/saveFile';
import { deleteApiKey, dumpAll, isStoragePersisted, loadApiKey, restoreAll, saveApiKey } from '../storage/repository';

const EXAMPLES: [string, string][] = [
  ['10:00', '15:00'],
  ['09:00', '16:00'],
  ['09:00', '17:00'],
  ['09:00', '18:00'],
];

export function SettingsPage() {
  const { settings, update } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [keyInput, setKeyInput] = useState('');
  const [savedKey, setSavedKey] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    loadApiKey().then(setSavedKey);
    isStoragePersisted().then(setPersisted);
  }, []);

  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(null), 2500);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const rules = [...draft.pay.breakRules].sort((a, b) => a.overHours - b.overHours);
  const setRule = (index: number, patch: Partial<BreakRule>) => {
    const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setDraft({ ...draft, pay: { ...draft.pay, breakRules: next } });
  };
  const ruleError = rules.length === 2 && rules[0].overHours >= rules[1].overHours ? '短い方の時間は、長い方より小さくしてください' : null;

  const saveKey = async () => {
    const k = keyInput.trim();
    if (!k.startsWith('sk-ant-')) {
      flash('⛔ APIキーは「sk-ant-」で始まる文字です。コピーし直してください');
      return;
    }
    await saveApiKey(k);
    setSavedKey(k);
    setKeyInput('');
    flash('APIキーをこの端末に保存しました');
  };
  const removeKey = async () => {
    if (!(await confirmDialog('この端末に保存したAPIキーを削除します。写真の読み取りは使えなくなります。', '削除する'))) return;
    await deleteApiKey();
    setSavedKey(undefined);
    flash('APIキーを削除しました');
  };

  const exportBackup = async () => {
    const backup = buildBackup(await dumpAll());
    const d = new Date();
    const name = `myshift-backup_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    const res = await saveFile(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }), name);
    if (res !== 'cancelled') flash(`バックアップ（${name}）を保存しました`);
  };
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const sum = summarizeBackup(backup);
      const ok = await confirmDialog(
        `${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('ja-JP') + ' に書き出した' : ''}バックアップを読み込みます。\n${sum.months.length ? `対象の月：${sum.months.join('、')}` : ''}${sum.hasSettings ? '（設定も含む）' : ''}\n同じ月のデータは、バックアップの内容に置き換わります。ほかの月はそのままです。`,
        '読み込む',
      );
      if (!ok) return;
      await restoreAll(backup.data);
      flash('バックアップを読み込みました。画面を読み込み直します');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      flash(`⛔ ${e instanceof Error ? e.message : '読み込めませんでした'}`);
    }
  };

  return (
    <div className="settings-page">
      {message && <p className="toast">{message.startsWith('⛔') ? message : `✅ ${message}`}</p>}

      <div className="grid">
        <Section title="給料の計算" icon="💴">
          <Field label="時給" hint="実働時間（休憩を引いた時間）× 時給 で計算します。割増は含みません">
            <Stepper value={draft.pay.hourlyWage} onChange={(v) => setDraft({ ...draft, pay: { ...draft.pay, hourlyWage: v ?? 0 } })} min={0} max={100000} step={10} unit="円" />
          </Field>
          <Field label="休憩（勤務の開始〜終了の長さで決まります）">
            <div className="break-rules">
              {rules.map((r, i) => (
                <div key={i} className="break-rule">
                  <Stepper value={r.overHours} onChange={(v) => setRule(i, { overHours: v ?? 0 })} min={0} max={24} step={0.5} unit="時間を超えたら" />
                  <Stepper value={r.minutes} onChange={(v) => setRule(i, { minutes: v ?? 0 })} min={0} max={240} step={5} unit="分" />
                </div>
              ))}
              <p className="field-hint">{rules[0] ? `${rules[0].overHours}時間以下の勤務は、休憩なしで計算します。` : ''}</p>
              {ruleError && <p className="issue issue-error">⛔ {ruleError}</p>}
            </div>
          </Field>
          <Field label="計算の例">
            <table className="score-table pay-examples">
              <tbody>
                {EXAMPLES.map(([s, e]) => {
                  const p = dayPay({ date: '2000-01-01', work: true, start: s, end: e }, draft.pay);
                  return (
                    <tr key={s + e}>
                      <td>
                        {s}〜{e}
                      </td>
                      <td>休憩{p.breakMinutes}分</td>
                      <td>実働{hm(p.workHours)}</td>
                      <td className="num">{yen(p.pay)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Field>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setDraft({ ...draft, pay: DEFAULT_PAY })}>
              初期値（1540円・60分/90分）に戻す
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || !!ruleError}
              onClick={async () => {
                await update(draft);
                flash('設定を保存しました');
              }}
            >
              保存する
            </button>
          </div>
        </Section>

        <Section title="写真の読み取り（Claude API）" icon="📷">
          <Field label="APIキー" hint="キーはこの端末の中だけに保存します。ソースコードやGitHub、出力ファイルには入りません">
            {savedKey ? (
              <div className="key-status">
                <span className="chip ok-chip">✓ 保存済み（…{savedKey.slice(-4)}）</span>
                <button type="button" className="btn btn-ghost" onClick={removeKey}>
                  削除
                </button>
              </div>
            ) : (
              <p className="muted">まだ設定されていません</p>
            )}
            <div className="key-input">
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-… を貼り付け"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                aria-label="Claude の APIキー"
              />
              <button type="button" className="btn btn-primary" disabled={!keyInput.trim()} onClick={saveKey}>
                {savedKey ? '入れ替える' : '保存'}
              </button>
            </div>
          </Field>
          <Field label="読み取りに使うモデル">
            <div className="model-options" role="radiogroup">
              {VISION_MODELS.map((m) => (
                <label key={m.id} className={`model-option ${draft.visionModel === m.id ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="vision-model"
                    checked={draft.visionModel === m.id}
                    onChange={async () => {
                      const next = { ...draft, visionModel: m.id };
                      setDraft(next);
                      await update({ ...settings, visionModel: m.id });
                      flash('モデルを切り替えました');
                    }}
                  />
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.note}</small>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <details className="howto">
            <summary>APIキーの作り方・料金について</summary>
            <ol>
              <li>
                パソコンかiPadで <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a> を開き、アカウントを作ります（claude.ai の有料プランとは別です）。
              </li>
              <li>「Billing（支払い）」でクレジットを購入します（先払い。購入できる金額は Console の画面で確認してください）。使いすぎ防止に、月の上限額も設定できます。</li>
              <li>「API Keys」→「Create Key」でキーを作り、表示された「sk-ant-…」をコピーして、上の欄に貼り付けます。キーは一度しか表示されません。</li>
            </ol>
            <p>
              料金は使った分だけです。画像1枚の読み取りで、Opus 5.5 は約10〜25円、Haiku 5.5 は約1円以下が目安です（1ドル＝150円で計算。画像の大きさや表の量で変わります）。
              画像は読み取りのために Anthropic に送られます。他人の個人情報が写った画像は、必要な部分だけを切り取ってから使うと安心です。
            </p>
          </details>
        </Section>
      </div>

      <Section title="データのバックアップ" icon="💾">
        <p className="muted">
          データはこの端末のブラウザの中だけに保存されています。機種変更や、うっかり消えたときに備えて、ときどき書き出しておくと安心です（APIキーは含みません）。
        </p>
        <div className="backup-actions">
          <button type="button" className="btn btn-primary" onClick={exportBackup}>
            ⬇️ バックアップを書き出す
          </button>
          <label className="btn btn-ghost file-btn">
            ⬆️ バックアップを読み込む
            <input type="file" accept="application/json,.json" onChange={(e) => { importBackup(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p className="field-hint">
          {persisted === true && '✓ この端末では、データが自動で消されにくい設定になっています。'}
          {persisted === false && 'iPhone・iPadでは、Safariで「ホーム画面に追加」して使うと、データが消されにくくなります。'}
        </p>
      </Section>
    </div>
  );
}
