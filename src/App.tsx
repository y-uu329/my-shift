import { useCallback, useEffect, useRef, useState } from 'react';
import { addMonths, currentYearMonth, formatYearMonth } from './domain/date';
import { ConfirmHost, confirmDialog } from './components/ConfirmDialog';
import { CalendarPage } from './pages/CalendarPage';
import { ConditionsPage } from './pages/ConditionsPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import { ImportPage } from './pages/ImportPage';
import { SettingsPage } from './pages/SettingsPage';
import { isPersistent, onPersistenceChange } from './storage/repository';

type Tab = 'conditions' | 'import' | 'calendar' | 'generate' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: string; ready: boolean }[] = [
  { id: 'conditions', label: '勤務条件', icon: '📝', ready: true },
  { id: 'import', label: '取り込み', icon: '📷', ready: true },
  { id: 'generate', label: 'シフト作成', icon: '✨', ready: true },
  { id: 'calendar', label: 'カレンダー', icon: '📅', ready: true },
  { id: 'history', label: '履歴・出力', icon: '📤', ready: true },
];

export function App() {
  // 初期表示は来月（来月のシフトを考えることが多いため）
  const [month, setMonth] = useState(() => addMonths(currentYearMonth(), 1));
  const [tab, setTab] = useState<Tab>('conditions');
  const [persistent, setPersistent] = useState(isPersistent());
  useEffect(() => {
    const off = onPersistenceChange(setPersistent);
    return () => {
      off();
    };
  }, []);
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  /** 保存していない変更があるときは、切り替える前に確認する */
  const confirmLeave = async () => !dirtyRef.current || (await confirmDialog('保存していない変更があります。保存せずに移動しますか？', '保存せずに移動'));

  const changeMonth = async (n: number) => {
    if (await confirmLeave()) setMonth((m) => addMonths(m, n));
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">マイシフト</h1>
        <div className="month-switch">
          <button type="button" className="icon-btn big" aria-label="前の月" onClick={() => changeMonth(-1)}>
            ‹
          </button>
          <span className="month-label">{formatYearMonth(month)}</span>
          <button type="button" className="icon-btn big" aria-label="次の月" onClick={() => changeMonth(1)}>
            ›
          </button>
          <button
            type="button"
            className={`icon-btn settings-btn ${tab === 'settings' ? 'active' : ''}`}
            aria-label="設定（時給・休憩・写真の読み取り）"
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={async () => {
              if (tab !== 'settings' && (await confirmLeave())) setTab('settings');
            }}
          >
            ⚙️
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="画面の切り替え">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={async () => {
              if (t.id !== tab && (await confirmLeave())) setTab(t.id);
            }}
          >
            <span aria-hidden>{t.icon}</span> {t.label}
            {!t.ready && <small className="soon">準備中</small>}
          </button>
        ))}
      </nav>

      {!persistent && (
        <p className="storage-warning" role="status">
          ⚠️ この画面では端末にデータを保存できません（プライベートブラウズなど）。入力した内容は、ページを閉じると消えます。
        </p>
      )}

      <main className="app-main">
        {tab === 'conditions' && <ConditionsPage month={month} onDirtyChange={onDirtyChange} />}
        {tab === 'generate' && <GeneratePage month={month} onGoConditions={() => setTab('conditions')} onGoCalendar={() => setTab('calendar')} />}
        {tab === 'calendar' && <CalendarPage month={month} onGoGenerate={() => setTab('generate')} />}
        {tab === 'import' && (
          <ImportPage month={month} onGoSettings={() => setTab('settings')} onGoConditions={() => setTab('conditions')} onGoCalendar={() => setTab('calendar')} />
        )}
        {tab === 'settings' && <SettingsPage />}
        {tab === 'history' && <HistoryPage month={month} onSelectMonth={setMonth} onGoCalendar={() => setTab('calendar')} />}
      </main>
      <ConfirmHost />
    </div>
  );
}
